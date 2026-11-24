require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '5mb' }));

const REPO_ROOT = path.join(__dirname, '..');
app.use(express.static(path.join(REPO_ROOT, 'interface')));

let dbConfig = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'time_tracking',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
};

function createPool(cfg) {
  const p = new Pool(cfg);
  p.on('error', (err) => {
    console.error('Erro em cliente ocioso do PostgreSQL Pool:', err.message);
  });
  return p;
}

let pool = createPool(dbConfig);

// Status da conexão + versão do PostgreSQL
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT version() AS version, current_database() AS db, current_user AS usr');
    res.json({
      ok: true,
      postgres: true,
      version: rows[0].version,
      database: rows[0].db,
      user: rows[0].usr,
      host: dbConfig.host,
      port: dbConfig.port,
    });
  } catch (err) {
    res.json({
      ok: true,
      postgres: false,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      user: dbConfig.user,
      error: err.message,
    });
  }
});

// Atualizar credenciais de conexão diretamente pela IDE
app.post('/api/connection', async (req, res) => {
  const { host, port, database, user, password } = req.body || {};
  const nextConfig = {
    host: host || dbConfig.host,
    port: Number(port || dbConfig.port),
    database: database || dbConfig.database,
    user: user || dbConfig.user,
    password: password !== undefined ? password : dbConfig.password,
  };

  const nextPool = createPool(nextConfig);
  try {
    const { rows } = await nextPool.query('SELECT version() AS version, current_database() AS db, current_user AS usr');
    await pool.end().catch(() => {});
    pool = nextPool;
    dbConfig = nextConfig;
    res.json({
      ok: true,
      postgres: true,
      version: rows[0].version,
      database: rows[0].db,
      user: rows[0].usr,
      host: dbConfig.host,
      port: dbConfig.port,
    });
  } catch (err) {
    await nextPool.end().catch(() => {});
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Execução de SQL arbitrário (SELECT, CALL, INSERT, UPDATE, DELETE, DDL, EXPLAIN...)
app.post('/api/query', async (req, res) => {
  const { sql } = req.body || {};
  if (!sql || !String(sql).trim()) {
    return res.status(400).json({ ok: false, error: 'Nenhum comando SQL informado.' });
  }

  const client = await pool.connect().catch((err) => {
    res.status(503).json({ ok: false, error: `Falha ao conectar ao PostgreSQL: ${err.message}` });
    return null;
  });
  if (!client) return;

  const notices = [];
  const onNotice = (msg) => notices.push(`${msg.severity || 'NOTICE'}: ${msg.message}`);
  client.on('notice', onNotice);

  const startedAt = Date.now();
  try {
    const result = await client.query(sql);
    const durationMs = Date.now() - startedAt;
    const finalRes = Array.isArray(result) ? result[result.length - 1] : result;

    res.json({
      ok: true,
      command: finalRes.command || 'SQL',
      rowCount: finalRes.rowCount ?? (finalRes.rows ? finalRes.rows.length : 0),
      fields: (finalRes.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
      rows: finalRes.rows || [],
      notices,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    res.status(400).json({
      ok: false,
      error: err.message,
      code: err.code || null,
      detail: err.detail || null,
      hint: err.hint || null,
      where: err.where || null,
      position: err.position || null,
      notices,
      durationMs,
    });
  } finally {
    client.removeListener('notice', onNotice);
    client.release();
  }
});

// Retorna metadados reais das tabelas do schema public + contagem de linhas
app.get('/api/schema', async (_req, res) => {
  try {
    const [{ rows: columns }, { rows: tables }] = await Promise.all([
      pool.query(`
        SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_schema = 'public'
         ORDER BY table_name, ordinal_position
      `),
      pool.query(`
        SELECT relname AS table_name, n_live_tup::int AS row_count
          FROM pg_stat_user_tables
         WHERE schemaname = 'public'
         ORDER BY relname
      `),
    ]);
    const rowCounts = {};
    for (const t of tables) rowCounts[t.table_name] = t.row_count;
    res.json({ ok: true, columns, rowCounts });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Executa todo o core do banco de dados na ordem segura: DDL -> DML -> Procedures/Functions -> Triggers -> Views
app.post('/api/run-core', async (_req, res) => {
  const folders = ['DDL', 'DML', 'Procedures_Functions', 'Triggers', 'Views'];
  const logs = [];
  const client = await pool.connect().catch((err) => {
    res.status(503).json({ ok: false, error: `Falha ao conectar ao PostgreSQL: ${err.message}` });
    return null;
  });
  if (!client) return;

  const startedAt = Date.now();
  try {
    for (const folder of folders) {
      const dirPath = path.join(REPO_ROOT, folder);
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const sql = fs.readFileSync(fullPath, 'utf8');
        const t0 = Date.now();
        await client.query(sql);
        logs.push({ file: `${folder}/${file}`, status: 'OK', ms: Date.now() - t0 });
      }
    }
    res.json({
      ok: true,
      executed: logs.length,
      durationMs: Date.now() - startedAt,
      logs,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message,
      detail: err.detail || null,
      where: err.where || null,
      logs,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    client.release();
  }
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`PostgreSQL Web IDE rodando em http://localhost:${PORT}`);
});
