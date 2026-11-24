/* ==========================================================================
   PG Studio — PostgreSQL Web IDE for Time_Tracking_Database_System
   - Modo PostgreSQL Real: via server/server.js (POST /api/query & /api/run-core)
   - Modo Offline: Simulador SQL local com dados reais + 5 Views + 20 DQL + 5 Procedures
   ========================================================================== */

const ide = {
  db: null,
  pgConnected: false,
  pgInfo: null,
  tabs: [],
  activeTabId: null,
  activeOutputTab: 'grid',
  explorerFilter: '',
  gridFilter: '',
  collapsedGroups: new Set(['ddl']),
  selectedTableForStructure: 'employee',
  liveSchema: null,
  liveRowCounts: null,
  messages: [],
  history: [],
  lastResult: { columns: [], rows: [], command: '', durationMs: 0 },
};

const SNIPPETS = {
  call_registrar_ok: `-- Teste 1: Marcação válida (Colaborador #21 tem espelho aberto em Out/2026)
CALL sp_registrar_marcacao_ponto(
  21,
  21,
  1,
  TIMESTAMP '2026-10-28 08:05:00',
  -22.906800,
  -43.172900,
  INET '10.10.21.15'
);`,
  call_registrar_alert: `-- Teste 2: Marcação fora do raio + IP externo (dispara tg_alertar_divergencia_geolocalizacao + network_divergence)
CALL sp_registrar_marcacao_ponto(
  21,
  21,
  1,
  TIMESTAMP '2026-10-28 08:25:00',
  -23.550520,
  -46.633308,
  INET '189.45.20.99'
);`,
  call_registrar_block: `-- Teste 3: Tentativa de marcação em espelho fechado (dispara tg_bloquear_alteracao_espelho_fechado)
CALL sp_registrar_marcacao_ponto(
  1,
  1,
  1,
  TIMESTAMP '2026-10-28 08:05:00',
  -23.550520,
  -46.633308,
  INET '10.10.1.15'
);`,
  call_fechar: `-- Fechar e assinar espelho mensal de Outubro/2026 do Colaborador #21
CALL sp_fechar_espelho_ponto_mensal(21, 2026, 10);`,
  call_abonar: `-- Abonar falta/atraso com documento comprobatório (dispara tg_auditoria_justificativas_abono)
CALL sp_abonar_falta_atraso(
  21,
  DATE '2026-10-19',
  DATE '2026-10-21',
  1,
  'ATESTADO-MED-2026-099.pdf',
  'rh.luis',
  'Atestado médico entregue ao RH'
);`,
  call_recalcular: `-- Recalcular movimentos e saldo do banco de horas do Colaborador #5
CALL sp_recalcular_banco_horas(5, DATE '2026-10-19', DATE '2026-10-31');`,
  call_escala: `-- Criar nova escala para o empregador #1 e vincular ao Colaborador #1 a partir de 2026-11-01
INSERT INTO work_schedule (employer_id, name, daily_minutes, tolerance_minutes)
VALUES (1, 'Escala Comercial 09-18', 480, 5)
ON CONFLICT (employer_id, name) DO NOTHING;

CALL sp_vincular_escala_trabalho(
  (SELECT work_schedule_id FROM work_schedule WHERE employer_id = 1 AND name = 'Escala Comercial 09-18'),
  ARRAY[1],
  DATE '2026-11-01'
);`,
};

// -------------------- Utilities --------------------
function cloneInitialDb() {
  return JSON.parse(JSON.stringify(window.INITIAL_DB));
}

function escapeHtml(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCell(val) {
  if (val === null || val === undefined) return '<span class="val-null">NULL</span>';
  if (typeof val === 'boolean') {
    return val
      ? '<span class="val-bool-true">true</span>'
      : '<span class="val-bool-false">false</span>';
  }
  if (typeof val === 'number') return `<span class="val-num">${val}</span>`;
  if (typeof val === 'object') return escapeHtml(JSON.stringify(val));
  return escapeHtml(val);
}

function addMessage(text, type = 'info') {
  const time = new Date().toLocaleTimeString('pt-BR');
  ide.messages.unshift({ time, text, type });
  if (ide.messages.length > 100) ide.messages.pop();
}

function byId(table, key) {
  const m = new Map();
  for (const r of ide.db[table] || []) m.set(r[key], r);
  return m;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ipInCidr(ip, cidr) {
  const toLong = (s) => {
    const p = String(s).split('.').map(Number);
    if (p.length !== 4 || p.some((x) => Number.isNaN(x))) return null;
    return ((p[0] << 24) >>> 0) + ((p[1] << 16) >>> 0) + ((p[2] << 8) >>> 0) + (p[3] >>> 0);
  };
  const [net, bitsStr] = String(cidr).split('/');
  const bits = Number(bitsStr ?? 32);
  const ipN = toLong(ip);
  const netN = toLong(net);
  if (ipN === null || netN === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipN & mask) === (netN & mask);
}

// Parse DDL/02_tables.sql for offline Structure view
function parseTableColumnsFromDdl(tableName) {
  const ddlObj = (window.SQL_OBJECTS.ddl || []).find((d) => d.id === '02_tables');
  if (!ddlObj) return [];
  const regex = new RegExp(`CREATE TABLE ${tableName}\\s*\\(([\\s\\S]*?)\\);`, 'i');
  const match = ddlObj.sql.match(regex);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((l) => l.trim().replace(/,$/, ''))
    .filter((l) => l && !l.startsWith('--'))
    .map((line) => {
      if (/^CONSTRAINT\s+/i.test(line)) {
        const parts = line.split(/\s+/);
        return {
          column_name: parts[1] || 'constraint',
          data_type: 'CONSTRAINT',
          is_nullable: '-',
          details: parts.slice(2).join(' '),
        };
      }
      const m = line.match(/^(\w+)\s+([a-zA-Z0-9_(),\s]+?)(\s+NOT NULL|\s+DEFAULT.*|\s+GENERATED.*|$)/i);
      return {
        column_name: m ? m[1] : line,
        data_type: m ? m[2].trim() : '',
        is_nullable: /NOT NULL/i.test(line) ? 'NO' : 'YES',
        details: m ? m[3].trim() : '',
      };
    });
}

// -------------------- Offline Views & DQL Engine --------------------
function computeViews() {
  const employees = byId('employee', 'employee_id');
  const departments = byId('department', 'department_id');
  const punchTypes = byId('punch_type', 'punch_type_id');
  const schedules = byId('work_schedule', 'work_schedule_id');

  const punchByEmpDate = new Map();
  for (const p of ide.db.time_punch) {
    const wd = String(p.punched_at).slice(0, 10);
    const tp = String(p.punched_at).slice(11, 19);
    const k = `${p.employee_id}|${wd}`;
    if (!punchByEmpDate.has(k)) punchByEmpDate.set(k, {});
    const rec = punchByEmpDate.get(k);
    const nm = punchTypes.get(p.punch_type_id)?.name;
    if (nm === 'Clock In' && (!rec.clock_in_time || tp < rec.clock_in_time)) rec.clock_in_time = tp;
    if (nm === 'Break Start' && (!rec.break_start_time || tp < rec.break_start_time)) rec.break_start_time = tp;
    if (nm === 'Break End' && (!rec.break_end_time || tp < rec.break_end_time)) rec.break_end_time = tp;
    if (nm === 'Clock Out' && (!rec.clock_out_time || tp > rec.clock_out_time)) rec.clock_out_time = tp;
  }

  const vw_espelho_ponto_detalhado = ide.db.daily_summary.map((s) => {
    const dp = punchByEmpDate.get(`${s.employee_id}|${s.work_date}`) || {};
    return {
      employee_id: s.employee_id,
      employee_name: employees.get(s.employee_id)?.name || '',
      year_month: String(s.work_date).slice(0, 7),
      work_date: s.work_date,
      clock_in_time: dp.clock_in_time || null,
      break_start_time: dp.break_start_time || null,
      break_end_time: dp.break_end_time || null,
      clock_out_time: dp.clock_out_time || null,
      worked_minutes: s.worked_minutes,
      late_minutes: s.late_minutes,
      overtime_minutes: s.overtime_minutes,
    };
  });

  const vw_resumo_banco_horas_colaboradores = ide.db.hour_bank
    .map((b) => {
      const e = employees.get(b.employee_id);
      if (!e || !e.active) return null;
      const d = departments.get(e.department_id);
      return {
        department_id: d?.department_id,
        department: d?.name || '',
        employee_id: e.employee_id,
        employee_name: e.name,
        balance_minutes: b.balance_minutes,
        balance_hours: Number((b.balance_minutes / 60).toFixed(2)),
        updated_at: b.updated_at,
        expires_at: b.expires_at,
      };
    })
    .filter(Boolean);

  const punchesById = byId('time_punch', 'time_punch_id');
  const vw_relatorio_inconsistencias_ponto = [];
  for (const a of ide.db.punch_audit) {
    const p = punchesById.get(a.time_punch_id);
    vw_relatorio_inconsistencias_ponto.push({
      employee_id: a.employee_id,
      employee_name: employees.get(a.employee_id)?.name || '',
      work_date: p ? String(p.punched_at).slice(0, 10) : '',
      inconsistency_type: a.alert_type,
    });
  }
  const counts = new Map();
  for (const p of ide.db.time_punch) {
    const k = `${p.employee_id}|${String(p.punched_at).slice(0, 10)}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [k, c] of counts.entries()) {
    if (c % 2 === 1) {
      const [eid, wd] = k.split('|');
      vw_relatorio_inconsistencias_ponto.push({
        employee_id: Number(eid),
        employee_name: employees.get(Number(eid))?.name || '',
        work_date: wd,
        inconsistency_type: 'odd_punch_count',
      });
    }
  }
  for (const s of ide.db.daily_summary) {
    if (s.insufficient_break) {
      vw_relatorio_inconsistencias_ponto.push({
        employee_id: s.employee_id,
        employee_name: employees.get(s.employee_id)?.name || '',
        work_date: s.work_date,
        inconsistency_type: 'insufficient_break',
      });
    }
  }

  const nightMap = new Map();
  for (const s of ide.db.daily_summary) {
    if (s.night_minutes > 0) {
      const ym = String(s.work_date).slice(0, 7);
      const k = `${s.employee_id}|${ym}`;
      if (!nightMap.has(k)) {
        nightMap.set(k, { employee_id: s.employee_id, employee_name: employees.get(s.employee_id)?.name || '', year_month: ym, night_minutes: 0 });
      }
      nightMap.get(k).night_minutes += s.night_minutes;
    }
  }
  const vw_demonstrativo_adicional_noturno = Array.from(nightMap.values()).map((r) => ({
    ...r,
    night_hours: Number((r.night_minutes / 60).toFixed(2)),
  }));

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const vw_escalas_jornadas_vigentes = ide.db.employee_schedule_history
    .filter((h) => !h.end_date)
    .map((h) => {
      const e = employees.get(h.employee_id);
      if (!e || !e.active) return null;
      const sc = schedules.get(h.work_schedule_id);
      const days = ide.db.work_schedule_day.filter((d) => d.work_schedule_id === h.work_schedule_id);
      const wd = days.filter((d) => !d.day_off);
      return {
        employee_id: e.employee_id,
        employee_name: e.name,
        work_schedule_id: sc?.work_schedule_id,
        schedule_name: sc?.name || '',
        daily_minutes: sc?.daily_minutes || 0,
        entry_time: wd[0]?.entry_time || null,
        break_start_time: wd[0]?.break_start_time || null,
        break_end_time: wd[0]?.break_end_time || null,
        exit_time: wd[0]?.exit_time || null,
        days_off: days.filter((d) => d.day_off).sort((a, b) => a.weekday - b.weekday).map((d) => dayNames[d.weekday]).join(', '),
      };
    })
    .filter(Boolean);

  return {
    vw_espelho_ponto_detalhado,
    vw_resumo_banco_horas_colaboradores,
    vw_relatorio_inconsistencias_ponto,
    vw_demonstrativo_adicional_noturno,
    vw_escalas_jornadas_vigentes,
  };
}

function runDqlLocal(id) {
  const empMap = byId('employee', 'employee_id');
  const deptMap = byId('department', 'department_id');
  const jobMap = byId('job_title', 'job_title_id');
  const empErMap = byId('employer', 'employer_id');
  const locMap = byId('work_location', 'work_location_id');
  const tsStatusMap = byId('timesheet_status', 'timesheet_status_id');
  const devMap = byId('device', 'device_id');
  const devTypeMap = byId('device_type', 'device_type_id');
  const adjTypeMap = byId('adjustment_type', 'adjustment_type_id');
  const recStatusMap = byId('record_status', 'record_status_id');
  const ds = ide.db.daily_summary;

  switch (id) {
    case '01_overtime_hours': {
      const m = new Map();
      for (const s of ds) if (s.overtime_minutes > 0) m.set(s.employee_id, (m.get(s.employee_id) || 0) + s.overtime_minutes);
      return Array.from(m.entries()).map(([eid, mins]) => ({
        employee_id: eid, employee_name: empMap.get(eid)?.name, overtime_minutes: mins, overtime_hours: Number((mins / 60).toFixed(2)),
      })).sort((a, b) => b.overtime_minutes - a.overtime_minutes);
    }
    case '02_late_arrivals_by_department': {
      const m = new Map();
      for (const s of ds) if (s.late_minutes > 0) {
        const k = deptMap.get(empMap.get(s.employee_id)?.department_id)?.name || 'N/A';
        if (!m.has(k)) m.set(k, { department: k, late_occurrences: 0, total_late_minutes: 0 });
        m.get(k).late_occurrences++;
        m.get(k).total_late_minutes += s.late_minutes;
      }
      return Array.from(m.values()).sort((a, b) => b.total_late_minutes - a.total_late_minutes);
    }
    case '03_employees_without_punches': {
      const punched = new Set(ide.db.time_punch.map((p) => p.employee_id));
      return ide.db.employee.filter((e) => !punched.has(e.employee_id)).map((e) => ({
        employee_id: e.employee_id, employee_name: e.name, department: deptMap.get(e.department_id)?.name, active: e.active,
      }));
    }
    case '04_punches_outside_location':
      return ide.db.time_punch.filter((p) => p.outside_perimeter).map((p) => {
        const e = empMap.get(p.employee_id);
        return { time_punch_id: p.time_punch_id, employee_name: e?.name, work_location: locMap.get(e?.work_location_id)?.name, punched_at: p.punched_at, ip_address: p.ip_address };
      });
    case '05_pending_timesheet_closings':
      return ide.db.timesheet.filter((t) => tsStatusMap.get(t.timesheet_status_id)?.name !== 'Closed').map((t) => ({
        timesheet_id: t.timesheet_id, employee_name: empMap.get(t.employee_id)?.name, status: tsStatusMap.get(t.timesheet_status_id)?.name, start_date: t.start_date, end_date: t.end_date, legal_deadline: t.legal_deadline,
      }));
    case '06_average_overtime_by_job_title': {
      const m = new Map();
      for (const s of ds) {
        const j = jobMap.get(empMap.get(s.employee_id)?.job_title_id)?.name || 'N/A';
        if (!m.has(j)) m.set(j, { job_title: j, sum: 0, count: 0 });
        m.get(j).sum += s.overtime_minutes; m.get(j).count++;
      }
      return Array.from(m.values()).map((r) => ({ job_title: r.job_title, days_analyzed: r.count, avg_overtime_minutes: Number((r.sum / r.count).toFixed(2)) }));
    }
    case '07_insufficient_break':
      return ds.filter((s) => s.insufficient_break).map((s) => ({ employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, work_date: s.work_date, worked_minutes: s.worked_minutes }));
    case '08_biometric_failures':
      return ide.db.biometric_failure.map((f) => {
        const d = devMap.get(f.device_id);
        return { biometric_failure_id: f.biometric_failure_id, employee_name: empMap.get(f.employee_id)?.name, device_serial: d?.serial_number, device_type: devTypeMap.get(d?.device_type_id)?.name, failed_at: f.failed_at, reason: f.reason };
      });
    case '09_night_shift_work': return computeViews().vw_demonstrativo_adicional_noturno;
    case '10_absenteeism_by_department': {
      const m = new Map();
      for (const s of ds) {
        const d = deptMap.get(empMap.get(s.employee_id)?.department_id)?.name || 'N/A';
        if (!m.has(d)) m.set(d, { department: d, total_days: 0, absences: 0 });
        m.get(d).total_days++; if (s.absent) m.get(d).absences++;
      }
      return Array.from(m.values()).map((r) => ({ ...r, absenteeism_pct: Number(((r.absences / r.total_days) * 100).toFixed(2)) }));
    }
    case '11_hours_worked_by_employer': {
      const m = new Map();
      for (const s of ds) {
        const k = empErMap.get(empMap.get(s.employee_id)?.employer_id)?.trade_name || 'N/A';
        if (!m.has(k)) m.set(k, { employer: k, worked_minutes: 0, overtime_minutes: 0 });
        m.get(k).worked_minutes += s.worked_minutes; m.get(k).overtime_minutes += s.overtime_minutes;
      }
      return Array.from(m.values()).map((r) => ({ employer: r.employer, worked_hours: Number((r.worked_minutes / 60).toFixed(2)), overtime_hours: Number((r.overtime_minutes / 60).toFixed(2)) }));
    }
    case '12_overtime_above_two_hours':
      return ds.filter((s) => s.overtime_minutes > 120).map((s) => ({ employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, work_date: s.work_date, overtime_minutes: s.overtime_minutes }));
    case '13_punctuality': {
      const m = new Map();
      for (const s of ds) {
        if (!m.has(s.employee_id)) m.set(s.employee_id, { employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, total_days: 0, on_time_days: 0 });
        m.get(s.employee_id).total_days++; if (s.late_minutes === 0 && !s.absent) m.get(s.employee_id).on_time_days++;
      }
      return Array.from(m.values()).map((r) => ({ ...r, punctuality_pct: Number(((r.on_time_days / r.total_days) * 100).toFixed(1)) })).sort((a, b) => b.punctuality_pct - a.punctuality_pct);
    }
    case '14_late_timesheet_closings':
      return ide.db.timesheet.filter((t) => t.closed_at && String(t.closed_at).slice(0, 10) > t.legal_deadline).map((t) => ({ timesheet_id: t.timesheet_id, employee_name: empMap.get(t.employee_id)?.name, legal_deadline: t.legal_deadline, closed_at: t.closed_at }));
    case '15_work_on_days_off':
      return ds.filter((s) => s.worked_on_day_off).map((s) => ({ employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, work_date: s.work_date, worked_minutes: s.worked_minutes, overtime_minutes: s.overtime_minutes }));
    case '16_weekend_hours':
      return ds.filter((s) => { const d = new Date(`${s.work_date}T12:00:00`).getDay(); return (d === 0 || d === 6) && s.worked_minutes > 0; }).map((s) => ({ employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, work_date: s.work_date, worked_minutes: s.worked_minutes }));
    case '17_device_divergence':
      return ide.db.punch_audit.map((a) => ({ punch_audit_id: a.punch_audit_id, time_punch_id: a.time_punch_id, employee_name: empMap.get(a.employee_id)?.name, alert_type: a.alert_type, description: a.description }));
    case '18_approved_manual_adjustments':
      return ide.db.punch_adjustment.filter((a) => recStatusMap.get(a.record_status_id)?.name === 'Approved').map((a) => ({ punch_adjustment_id: a.punch_adjustment_id, employee_name: empMap.get(a.employee_id)?.name, adjustment_type: adjTypeMap.get(a.adjustment_type_id)?.name, adjustment_date: a.adjustment_date, reason: a.reason }));
    case '19_forgotten_punches':
      return ds.filter((s) => s.missing_clock_out).map((s) => ({ employee_id: s.employee_id, employee_name: empMap.get(s.employee_id)?.name, work_date: s.work_date, missing_clock_out: s.missing_clock_out }));
    case '20_payroll_report':
      return ide.db.timesheet.map((t) => ({
        employee_id: t.employee_id, employee_name: empMap.get(t.employee_id)?.name, employer: empErMap.get(empMap.get(t.employee_id)?.employer_id)?.trade_name, status: tsStatusMap.get(t.timesheet_status_id)?.name,
        worked_hours: Number((t.worked_minutes / 60).toFixed(2)), overtime_hours: Number((t.overtime_minutes / 60).toFixed(2)), night_hours: Number((t.night_minutes / 60).toFixed(2)), absence_hours: Number((t.absence_minutes / 60).toFixed(2)),
      }));
    default: return [];
  }
}

// Offline SQL Evaluator (for when opened directly without Node/Postgres)
function executeSqlOffline(rawSql) {
  const t0 = performance.now();
  const sql = rawSql.trim();
  const clean = sql.replace(/--[^\n]*/g, '').trim();

  // 1. Check if matches any DQL script from repository
  const matchedDql = (window.SQL_OBJECTS.dql || []).find((d) => {
    const dClean = d.sql.replace(/--[^\n]*/g, '').trim();
    return clean === dClean || sql === d.sql;
  });
  if (matchedDql) {
    const rows = runDqlLocal(matchedDql.id);
    return {
      ok: true,
      command: 'SELECT',
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      notices: [`Executado script DQL/${matchedDql.filename} no Engine Local.`],
    };
  }

  // 2. Check CALL sp_registrar_marcacao_ponto(...)
  if (/^CALL\s+sp_registrar_marcacao_ponto\s*\(/i.test(clean)) {
    const m = clean.match(/\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:TIMESTAMP\s+)?'([^']+)'\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(?:INET\s+)?'([^']+)'\s*\)/i);
    if (!m) throw new Error('Sintaxe esperada: CALL sp_registrar_marcacao_ponto(emp_id, dev_id, punch_type_id, TIMESTAMP \'...\', lat, lon, INET \'...\');');
    const [, empIdS, devIdS, ptIdS, punchedAt, latS, lonS, ip] = m;
    const empId = Number(empIdS), devId = Number(devIdS), ptId = Number(ptIdS), lat = Number(latS), lon = Number(lonS);
    const emp = ide.db.employee.find((e) => e.employee_id === empId && e.active);
    if (!emp) throw new Error('Employee not found or inactive');
    const loc = ide.db.work_location.find((l) => l.work_location_id === emp.work_location_id);
    const workDate = punchedAt.slice(0, 10);

    const closedId = ide.db.timesheet_status.find((s) => s.name === 'Closed')?.timesheet_status_id;
    const blocked = ide.db.timesheet.some((t) => t.employee_id === empId && t.timesheet_status_id === closedId && t.signed_at && t.start_date <= workDate && t.end_date >= workDate);
    if (blocked) throw new Error('ERROR: Period is blocked by a closed and signed timesheet\nCONTEXT: PL/pgSQL function fn_tg_block_closed_timesheet() (Trigger tg_bloquear_alteracao_espelho_fechado)');

    const newTs = new Date(punchedAt.replace(' ', 'T')).getTime();
    const tooClose = ide.db.time_punch.some((p) => p.employee_id === empId && Math.abs(newTs - new Date(p.punched_at.replace(' ', 'T')).getTime()) / 60000 < 5);
    if (tooClose) throw new Error('ERROR: Minimum 5-minute interval between punches\nCONTEXT: Trigger tg_validar_intervalo_minimo_marcacoes');

    const dist = haversineMeters(lat, lon, loc.latitude, loc.longitude);
    const outside = dist > loc.radius_meters;
    const nextId = Math.max(0, ...ide.db.time_punch.map((p) => p.time_punch_id)) + 1;
    const nextSeq = Math.max(0, ...ide.db.time_punch.map((p) => p.sequence_number)) + 1;
    ide.db.time_punch.push({ time_punch_id: nextId, employer_id: emp.employer_id, employee_id: empId, device_id: devId, punch_type_id: ptId, sequence_number: nextSeq, punched_at: punchedAt, latitude: lat, longitude: lon, ip_address: ip, outside_perimeter: outside });

    const notices = [`CALL sp_registrar_marcacao_ponto concluída (time_punch_id = ${nextId}).`];
    if (outside) {
      const nextAuditId = Math.max(0, ...ide.db.punch_audit.map((a) => a.punch_audit_id)) + 1;
      ide.db.punch_audit.push({ punch_audit_id: nextAuditId, time_punch_id: nextId, employee_id: empId, alert_type: 'geolocation_divergence', description: `Distância ${Math.round(dist)}m > raio ${loc.radius_meters}m` });
      notices.push(`NOTICE [tg_alertar_divergencia_geolocalizacao]: Alerta gravado em punch_audit (${Math.round(dist)}m do local).`);
    }
    if (!ipInCidr(ip, loc.allowed_network)) {
      const nextAuditId = Math.max(0, ...ide.db.punch_audit.map((a) => a.punch_audit_id)) + 1;
      ide.db.punch_audit.push({ punch_audit_id: nextAuditId, time_punch_id: nextId, employee_id: empId, alert_type: 'network_divergence', description: `IP ${ip} fora da rede ${loc.allowed_network}` });
      notices.push(`NOTICE [CIDR]: Divergência de rede gravada em punch_audit (${ip} fora de ${loc.allowed_network}).`);
    }
    return { ok: true, command: 'CALL', rows: [], columns: [], rowCount: 0, durationMs: Math.max(1, Math.round(performance.now() - t0)), notices };
  }

  // 3. Check CALL sp_fechar_espelho_ponto_mensal(...)
  if (/^CALL\s+sp_fechar_espelho_ponto_mensal\s*\(/i.test(clean)) {
    const m = clean.match(/\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (!m) throw new Error('Sintaxe esperada: CALL sp_fechar_espelho_ponto_mensal(employee_id, year, month);');
    const [, eS, yS, mS] = m;
    const empId = Number(eS), startDate = `${yS}-${String(mS).padStart(2, '0')}-01`;
    const closedId = ide.db.timesheet_status.find((s) => s.name === 'Closed')?.timesheet_status_id;
    const ts = ide.db.timesheet.find((t) => t.employee_id === empId && t.start_date === startDate);
    if (!ts) throw new Error('No timesheet/daily summary found for the period');
    if (ts.timesheet_status_id === closedId) throw new Error('The timesheet for the period is already closed');
    ts.timesheet_status_id = closedId;
    ts.closed_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    ts.signed_at = ts.closed_at;
    return { ok: true, command: 'CALL', rows: [], columns: [], rowCount: 0, durationMs: 2, notices: [`Espelho de employee_id=${empId} (${startDate}) fechado e assinado com sucesso.`] };
  }

  // 4. Other CALL statements
  if (/^CALL\s+(sp_abonar_falta_atraso|sp_recalcular_banco_horas|sp_vincular_escala_trabalho)/i.test(clean)) {
    const name = clean.match(/^CALL\s+(\w+)/i)[1];
    return { ok: true, command: 'CALL', rows: [], columns: [], rowCount: 0, durationMs: 2, notices: [`${name} executada no Engine Local. Conecte ao PostgreSQL (server/) para execução PL/pgSQL completa.`] };
  }

  // 5. Simple SELECT * FROM <table_or_view> [WHERE col = val] [LIMIT n]
  const selMatch = clean.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?\s*;?$/i);
  if (selMatch) {
    const [, proj, sourceName, whereClause, orderClause, limitStr] = selMatch;
    const views = computeViews();
    let rows = ide.db[sourceName] || views[sourceName];
    if (!rows) throw new Error(`ERROR: relation "${sourceName}" does not exist`);
    rows = [...rows];

    if (whereClause) {
      const eqM = whereClause.trim().match(/^(\w+)\s*=\s*(?:'([^']*)'|(\d+(?:\.\d+)?)|(true|false))$/i);
      if (eqM) {
        const col = eqM[1];
        const target = eqM[2] !== undefined ? eqM[2] : eqM[3] !== undefined ? Number(eqM[3]) : eqM[4].toLowerCase() === 'true';
        rows = rows.filter((r) => r[col] === target);
      }
    }
    if (orderClause) {
      const [col, dir] = orderClause.trim().split(/\s+/);
      const desc = /^DESC$/i.test(dir || '');
      rows.sort((a, b) => (a[col] > b[col] ? (desc ? -1 : 1) : a[col] < b[col] ? (desc ? 1 : -1) : 0));
    }
    if (limitStr) rows = rows.slice(0, Number(limitStr));

    if (/^COUNT\s*\(\s*\*\s*\)(?:\s+AS\s+\w+)?$/i.test(proj.trim())) {
      const aliasM = proj.trim().match(/AS\s+(\w+)$/i);
      const colName = aliasM ? aliasM[1] : 'count';
      const cntRows = [{ [colName]: rows.length }];
      return {
        ok: true,
        command: 'SELECT',
        rows: cntRows,
        columns: [colName],
        rowCount: 1,
        durationMs: Math.max(1, Math.round(performance.now() - t0)),
        notices: [],
      };
    }

    if (proj.trim() !== '*') {
      const wantedCols = proj.split(',').map((c) => c.trim().split(/\s+AS\s+/i)[0].trim());
      if (wantedCols.every((c) => rows.length === 0 || c in rows[0])) {
        rows = rows.map((r) => {
          const obj = {};
          for (const c of wantedCols) obj[c] = r[c];
          return obj;
        });
      }
    }

    return {
      ok: true,
      command: 'SELECT',
      rows,
      columns: rows[0] ? Object.keys(rows[0]) : [],
      rowCount: rows.length,
      durationMs: Math.max(1, Math.round(performance.now() - t0)),
      notices: [],
    };
  }

  // 6. DDL / CREATE statements preview
  if (/^(CREATE|DROP|ALTER)\s+/i.test(clean)) {
    return {
      ok: true,
      command: 'DDL',
      rows: [],
      columns: [],
      rowCount: 0,
      durationMs: 1,
      notices: ['Script DDL validado no Modo Offline. Para aplicar no banco real, conecte ao PostgreSQL via server/server.js.'],
    };
  }

  throw new Error('Modo Offline suporta: SELECT * FROM <tabela/view>, os 20 scripts DQL/ e CALL sp_... Para SQL PostgreSQL completo (JOINs customizados, CTEs, EXPLAIN), inicie o backend em server/.');
}

// -------------------- Execution Controller --------------------
async function executeQuery(sqlToRun) {
  const sql = (sqlToRun || '').trim();
  if (!sql) return;

  ide.history.unshift({ at: new Date().toLocaleTimeString('pt-BR'), sql });
  if (ide.history.length > 50) ide.history.pop();

  let res;
  if (ide.pgConnected) {
    try {
      const r = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql }),
      });
      res = await r.json();
    } catch (err) {
      res = { ok: false, error: `Erro de comunicação com o servidor: ${err.message}`, durationMs: 0 };
    }
  } else {
    try {
      res = executeSqlOffline(sql);
    } catch (err) {
      res = { ok: false, error: err.message, durationMs: 1 };
    }
  }

  if (res.ok) {
    const columns = res.fields ? res.fields.map((f) => f.name) : res.columns || (res.rows?.[0] ? Object.keys(res.rows[0]) : []);
    ide.lastResult = {
      columns,
      rows: res.rows || [],
      command: res.command || 'OK',
      durationMs: res.durationMs || 0,
    };
    const msg = `${res.command || 'SQL'} concluído com sucesso (${res.rowCount ?? (res.rows?.length || 0)} linhas) em ${res.durationMs || 0} ms.`;
    addMessage(msg, 'ok');
    for (const n of res.notices || []) addMessage(n, 'warn');

    ide.activeOutputTab = columns.length > 0 ? 'grid' : 'messages';
  } else {
    let errText = res.error || 'Erro ao executar SQL';
    if (res.code) errText = `[SQLSTATE ${res.code}] ${errText}`;
    if (res.detail) errText += `\nDETAIL: ${res.detail}`;
    if (res.hint) errText += `\nHINT: ${res.hint}`;
    if (res.where) errText += `\nWHERE: ${res.where}`;
    addMessage(errText, 'err');
    ide.activeOutputTab = 'messages';
  }

  renderOutput();
  renderExplorer();
}

// -------------------- Tabs Management --------------------
function createTab(title, sql, autoRun = false) {
  const existing = ide.tabs.find((t) => t.title === title);
  if (existing) {
    ide.activeTabId = existing.id;
    syncEditorFromTab();
    renderTabs();
    if (autoRun) executeQuery(existing.sql);
    return;
  }
  const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  ide.tabs.push({ id, title, sql });
  ide.activeTabId = id;
  syncEditorFromTab();
  renderTabs();
  if (autoRun) executeQuery(sql);
}

function closeTab(id) {
  if (ide.tabs.length <= 1) return;
  const idx = ide.tabs.findIndex((t) => t.id === id);
  ide.tabs.splice(idx, 1);
  if (ide.activeTabId === id) {
    ide.activeTabId = ide.tabs[Math.max(0, idx - 1)].id;
  }
  syncEditorFromTab();
  renderTabs();
}

function getActiveTab() {
  return ide.tabs.find((t) => t.id === ide.activeTabId);
}

function syncEditorFromTab() {
  const tab = getActiveTab();
  const editor = document.getElementById('sql-editor');
  if (tab && editor) {
    editor.value = tab.sql;
    updateGutter();
  }
}

function updateGutter() {
  const editor = document.getElementById('sql-editor');
  const gutter = document.getElementById('editor-gutter');
  const lines = editor.value.split('\n').length;
  let html = '';
  for (let i = 1; i <= lines; i++) html += `${i}<br>`;
  gutter.innerHTML = html;
}

// -------------------- Rendering --------------------
function renderExplorer() {
  const tree = document.getElementById('explorer-tree');
  const q = ide.explorerFilter.trim().toLowerCase();
  const matches = (txt) => !q || txt.toLowerCase().includes(q);

  const tables = Object.keys(ide.db).filter(matches);
  const views = (window.SQL_OBJECTS.views || []).filter((v) => matches(v.filename));
  const procs = (window.SQL_OBJECTS.procedures || []).filter((p) => matches(p.filename));
  const triggers = (window.SQL_OBJECTS.triggers || []).filter((t) => matches(t.filename));
  const dqls = (window.SQL_OBJECTS.dql || []).filter((d) => matches(d.filename) || matches(d.description));
  const ddls = (window.SQL_OBJECTS.ddl || []).filter((d) => matches(d.filename));

  const renderGroup = (key, icon, label, items, renderItem) => `
    <div class="tree-group ${ide.collapsedGroups.has(key) && !q ? 'collapsed' : ''}" data-group="${key}">
      <div class="tree-group-header" data-toggle-group="${key}">
        <span class="tree-chevron">▾</span>
        <span>${icon}</span>
        <span>${label}</span>
        <span class="tree-count">${items.length}</span>
      </div>
      <div class="tree-items">${items.map(renderItem).join('')}</div>
    </div>
  `;

  tree.innerHTML =
    renderGroup('tables', '📋', 'Tables', tables, (t) => {
      const cnt = ide.pgConnected && ide.liveRowCounts && ide.liveRowCounts[t] !== undefined
        ? ide.liveRowCounts[t]
        : ide.db[t].length;
      return `
      <div class="tree-item" data-open-table="${t}" title="Abrir SELECT * FROM ${t}">
        <span>▪</span><span>${t}</span>
        <span class="tree-item-meta">${cnt}</span>
      </div>
    `;
    }) +
    renderGroup('views', '👁️', 'Views', views, (v) => {
      const vwName = v.id.replace(/^\d+_/, '');
      return `<div class="tree-item" data-open-view="${v.id}" title="${escapeHtml(v.description)}"><span>▪</span><span>${vwName}</span></div>`;
    }) +
    renderGroup('dql', '📈', 'Consultas DQL', dqls, (d) => `
      <div class="tree-item" data-open-dql="${d.id}" title="${escapeHtml(d.description)}"><span>▪</span><span>${d.filename}</span></div>
    `) +
    renderGroup('procedures', '⚙️', 'Procedures & Functions', procs, (p) => `
      <div class="tree-item" data-open-proc="${p.id}" title="${escapeHtml(p.description)}"><span>▪</span><span>${p.id.replace(/^\d+_/, '')}</span></div>
    `) +
    renderGroup('triggers', '⚡', 'Triggers', triggers, (t) => `
      <div class="tree-item" data-open-trigger="${t.id}" title="${escapeHtml(t.description)}"><span>▪</span><span>${t.id.replace(/^\d+_/, '')}</span></div>
    `) +
    renderGroup('ddl', '📦', 'Scripts DDL', ddls, (d) => `
      <div class="tree-item" data-open-ddl="${d.id}" title="${escapeHtml(d.description)}"><span>▪</span><span>${d.filename}</span></div>
    `);

  // Bind explorer events
  tree.querySelectorAll('[data-toggle-group]').forEach((el) => {
    el.onclick = () => {
      const g = el.dataset.toggleGroup;
      if (ide.collapsedGroups.has(g)) ide.collapsedGroups.delete(g);
      else ide.collapsedGroups.add(g);
      renderExplorer();
    };
  });

  tree.querySelectorAll('[data-open-table]').forEach((el) => {
    el.onclick = () => {
      const t = el.dataset.openTable;
      ide.selectedTableForStructure = t;
      createTab(`table: ${t}`, `SELECT * FROM ${t} LIMIT 100;`, true);
    };
  });

  tree.querySelectorAll('[data-open-view]').forEach((el) => {
    el.onclick = () => {
      const obj = window.SQL_OBJECTS.views.find((v) => v.id === el.dataset.openView);
      const vwName = obj.id.replace(/^\d+_/, '');
      createTab(`view: ${vwName}`, `SELECT * FROM ${vwName};`, true);
    };
  });

  tree.querySelectorAll('[data-open-dql]').forEach((el) => {
    el.onclick = () => {
      const obj = window.SQL_OBJECTS.dql.find((d) => d.id === el.dataset.openDql);
      createTab(obj.filename, obj.sql, true);
    };
  });

  tree.querySelectorAll('[data-open-proc]').forEach((el) => {
    el.onclick = () => {
      const obj = window.SQL_OBJECTS.procedures.find((p) => p.id === el.dataset.openProc);
      createTab(obj.filename, obj.sql, false);
    };
  });

  tree.querySelectorAll('[data-open-trigger]').forEach((el) => {
    el.onclick = () => {
      const obj = window.SQL_OBJECTS.triggers.find((t) => t.id === el.dataset.openTrigger);
      createTab(obj.filename, obj.sql, false);
    };
  });

  tree.querySelectorAll('[data-open-ddl]').forEach((el) => {
    el.onclick = () => {
      const obj = window.SQL_OBJECTS.ddl.find((d) => d.id === el.dataset.openDdl);
      createTab(obj.filename, obj.sql, false);
    };
  });
}

function renderTabs() {
  const bar = document.getElementById('tabs-bar');
  bar.innerHTML =
    ide.tabs
      .map(
        (t) => `
      <div class="query-tab ${t.id === ide.activeTabId ? 'active' : ''}" data-tab-id="${t.id}">
        <span>${escapeHtml(t.title)}</span>
        ${ide.tabs.length > 1 ? `<span class="tab-close" data-close-tab="${t.id}">×</span>` : ''}
      </div>`
      )
      .join('') + `<button class="tab-add" id="btn-add-tab" title="Nova aba SQL">+</button>`;

  bar.querySelectorAll('[data-tab-id]').forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.closeTab) return;
      ide.activeTabId = el.dataset.tabId;
      syncEditorFromTab();
      renderTabs();
    };
  });
  bar.querySelectorAll('[data-close-tab]').forEach((el) => {
    el.onclick = () => closeTab(el.dataset.closeTab);
  });
  document.getElementById('btn-add-tab').onclick = () => {
    createTab(`Query ${ide.tabs.length + 1}`, '-- Nova consulta SQL\nSELECT * FROM employee LIMIT 20;', false);
  };
}

function renderOutput() {
  document.querySelectorAll('.out-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.out === ide.activeOutputTab);
  });

  const body = document.getElementById('output-body');
  const stats = document.getElementById('out-stats');
  const filterInput = document.getElementById('grid-filter');
  filterInput.style.display = ide.activeOutputTab === 'grid' ? 'block' : 'none';

  if (ide.activeOutputTab === 'grid') {
    const { columns, rows, durationMs } = ide.lastResult;
    const q = ide.gridFilter.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => columns.some((c) => String(r[c] ?? '').toLowerCase().includes(q)))
      : rows;

    stats.textContent = `${filtered.length} linha(s) • ${durationMs} ms`;

    if (!columns.length) {
      body.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Nenhum resultado tabular. Execute uma consulta SELECT (Ctrl+Enter / F5) ou veja a aba Messages.</div>';
      return;
    }

    const head = `<th class="row-num-col">#</th>` + columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const rowsHtml = filtered
      .slice(0, 500)
      .map((r, i) => `<tr><td class="row-num-col">${i + 1}</td>${columns.map((c) => `<td title="${escapeHtml(r[c] ?? 'NULL')}">${formatCell(r[c])}</td>`).join('')}</tr>`)
      .join('');

    body.innerHTML = `<table class="data-grid"><thead><tr>${head}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
  } else if (ide.activeOutputTab === 'messages') {
    stats.textContent = `${ide.messages.length} mensagem(ns)`;
    body.innerHTML = `<div class="console-log">${
      ide.messages.length
        ? ide.messages.map((m) => `<div class="msg-line ${m.type}">[${m.time}] ${escapeHtml(m.text)}</div>`).join('')
        : '<div style="color:var(--text-muted)">Sem mensagens no console.</div>'
    }</div>`;
  } else if (ide.activeOutputTab === 'structure') {
    const tName = ide.selectedTableForStructure;
    let cols = [];
    if (ide.pgConnected && ide.liveSchema) {
      cols = ide.liveSchema.filter((c) => c.table_name === tName);
    } else {
      cols = parseTableColumnsFromDdl(tName);
    }
    stats.textContent = `Tabela: ${tName} (${cols.length} itens)`;
    if (!cols.length) {
      body.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Selecione uma tabela no Object Explorer para inspecionar sua estrutura.</div>';
      return;
    }
    const keys = Object.keys(cols[0]);
    body.innerHTML = `
      <table class="data-grid">
        <thead><tr><th class="row-num-col">#</th>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
        <tbody>${cols.map((c, i) => `<tr><td class="row-num-col">${i + 1}</td>${keys.map((k) => `<td>${formatCell(c[k])}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>`;
  } else if (ide.activeOutputTab === 'history') {
    stats.textContent = `${ide.history.length} execução(ões)`;
    body.innerHTML = ide.history.length
      ? ide.history
          .map(
            (h, idx) => `
          <div class="history-item" data-hist-idx="${idx}">
            <span style="color:var(--text-dim)">${h.at}</span>
            <span class="history-sql">${escapeHtml(h.sql.replace(/\s+/g, ' '))}</span>
          </div>`
          )
          .join('')
      : '<div style="padding:20px;color:var(--text-muted)">Nenhuma query executada nesta sessão.</div>';

    body.querySelectorAll('[data-hist-idx]').forEach((el) => {
      el.onclick = () => {
        const item = ide.history[Number(el.dataset.histIdx)];
        createTab(`History ${item.at}`, item.sql, false);
      };
    });
  }
}

function updateConnectionUI(info) {
  const dot = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  const statusBar = document.getElementById('ide-statusbar');
  const statusMode = document.getElementById('status-mode');
  const statusDb = document.getElementById('status-db');

  if (info && info.postgres) {
    ide.pgConnected = true;
    ide.pgInfo = info;
    dot.classList.add('pg');
    label.textContent = `${info.user}@${info.host}:${info.port}/${info.database}`;
    statusBar.classList.remove('offline');
    statusMode.textContent = `PostgreSQL Conectado — ${(info.version || '').split(' ').slice(0, 2).join(' ')}`;
    statusDb.textContent = `db: ${info.database}`;
    document.getElementById('cfg-host').value = info.host || 'localhost';
    document.getElementById('cfg-port').value = info.port || 5432;
    document.getElementById('cfg-database').value = info.database || 'time_tracking';
    document.getElementById('cfg-user').value = info.user || 'postgres';
  } else {
    ide.pgConnected = false;
    dot.classList.remove('pg');
    label.textContent = 'Engine Local (Offline)';
    statusBar.classList.add('offline');
    statusMode.textContent = 'Modo Offline (Simulador SQL + Dados do Repositório)';
    statusDb.textContent = 'db: time_tracking (local)';
  }
}

async function refreshLiveSchema() {
  if (!ide.pgConnected) return;
  try {
    const sr = await fetch('/api/schema');
    if (sr.ok) {
      const sData = await sr.json();
      ide.liveSchema = sData.columns || null;
      ide.liveRowCounts = sData.rowCounts || null;
      renderExplorer();
    }
  } catch {
    // ignore
  }
}

async function checkBackend() {
  if (!location.protocol.startsWith('http')) return;
  try {
    const r = await fetch('/api/health');
    if (r.ok) {
      const info = await r.json();
      updateConnectionUI(info);
      if (info.postgres) {
        addMessage(`Conectado ao PostgreSQL real (${info.user}@${info.host}:${info.port}/${info.database}).`, 'ok');
        await refreshLiveSchema();
      } else if (info.error) {
        addMessage(`Servidor Node ativo, mas PostgreSQL não conectou ainda: ${info.error}. Clique no botão de conexão no topo para configurar.`, 'warn');
      }
      renderOutput();
    }
  } catch {
    // Offline file:// mode
  }
}

// -------------------- CSV Export --------------------
function exportCsv() {
  const { columns, rows } = ide.lastResult;
  if (!columns.length || !rows.length) {
    addMessage('Nenhum dado na grade para exportar CSV.', 'warn');
    ide.activeOutputTab = 'messages';
    renderOutput();
    return;
  }
  const esc = (v) => {
    const str = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    return `"${str.replace(/"/g, '""')}"`;
  };
  const csv = [columns.map(esc).join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `query_result_${Date.now()}.csv`;
  a.click();
}

// -------------------- Resizer --------------------
function initResizer() {
  const resizer = document.getElementById('pane-resizer');
  const editorPane = document.getElementById('editor-pane');
  const outputPane = document.getElementById('output-pane');
  let dragging = false;

  resizer.addEventListener('mousedown', () => {
    dragging = true;
    document.body.style.cursor = 'row-resize';
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const ws = document.querySelector('.workspace').getBoundingClientRect();
    const topOffset = 75;
    const avail = ws.height - topOffset;
    const y = Math.max(120, Math.min(avail - 150, e.clientY - ws.top - topOffset));
    editorPane.style.flex = `0 0 ${y}px`;
    outputPane.style.flex = '1 1 auto';
  });
  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
    }
  });
}

// -------------------- Init --------------------
document.addEventListener('DOMContentLoaded', async () => {
  ide.db = cloneInitialDb();

  const editor = document.getElementById('sql-editor');
  const gutter = document.getElementById('editor-gutter');

  editor.addEventListener('input', () => {
    const tab = getActiveTab();
    if (tab) tab.sql = editor.value;
    updateGutter();
  });
  editor.addEventListener('scroll', () => {
    gutter.scrollTop = editor.scrollTop;
  });
  const updateCursorStatus = () => {
    const pos = editor.selectionStart;
    const before = editor.value.slice(0, pos).split('\n');
    document.getElementById('status-cursor').textContent = `Ln ${before.length}, Col ${before[before.length - 1].length + 1}`;
  };
  editor.addEventListener('keyup', updateCursorStatus);
  editor.addEventListener('click', updateCursorStatus);
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.key === 'Enter') || e.key === 'F5') {
      e.preventDefault();
      executeQuery(editor.value);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(editor.selectionEnd);
      editor.selectionStart = editor.selectionEnd = s + 2;
      const tab = getActiveTab();
      if (tab) tab.sql = editor.value;
    }
  });

  // Toolbar buttons
  document.getElementById('btn-exec').onclick = () => executeQuery(editor.value);
  document.getElementById('btn-exec-sel').onclick = () => {
    const sel = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    executeQuery(sel || editor.value);
  };
  document.getElementById('btn-clear').onclick = () => {
    editor.value = '';
    const tab = getActiveTab();
    if (tab) tab.sql = '';
    updateGutter();
  };
  document.getElementById('btn-export-csv').onclick = exportCsv;

  document.getElementById('snippet-select').onchange = (e) => {
    const k = e.target.value;
    if (k && SNIPPETS[k]) {
      createTab(`snippet: ${k}`, SNIPPETS[k], false);
    }
    e.target.value = '';
  };

  // Output tabs & filters
  document.querySelectorAll('.out-tab').forEach((btn) => {
    btn.onclick = () => {
      ide.activeOutputTab = btn.dataset.out;
      renderOutput();
    };
  });
  document.getElementById('explorer-filter').oninput = (e) => {
    ide.explorerFilter = e.target.value;
    renderExplorer();
  };
  document.getElementById('grid-filter').oninput = (e) => {
    ide.gridFilter = e.target.value;
    renderOutput();
  };

  // Run Core button
  document.getElementById('btn-run-core').onclick = async () => {
    if (!ide.pgConnected) {
      ide.db = cloneInitialDb();
      addMessage('Modo Offline: dados iniciais das 25 tabelas restaurados. Para executar os scripts reais (DDL/DML/Procedures/Triggers/Views) no PostgreSQL, inicie o servidor em server/.', 'info');
      ide.activeOutputTab = 'messages';
      renderExplorer();
      renderOutput();
      return;
    }
    addMessage('Executando core completo do projeto no PostgreSQL (DDL → DML → Procedures_Functions → Triggers → Views)...', 'info');
    ide.activeOutputTab = 'messages';
    renderOutput();
    try {
      const r = await fetch('/api/run-core', { method: 'POST' });
      const data = await r.json();
      if (data.ok) {
        addMessage(`Core instalado com sucesso! ${data.executed} arquivos SQL executados em ${data.durationMs} ms.`, 'ok');
        await refreshLiveSchema();
      } else {
        addMessage(`Erro ao executar core: ${data.error}${data.detail ? '\nDETAIL: ' + data.detail : ''}`, 'err');
      }
    } catch (err) {
      addMessage(`Falha ao chamar /api/run-core: ${err.message}`, 'err');
    }
    renderOutput();
  };

  // Connection modal
  const modal = document.getElementById('conn-modal');
  document.getElementById('btn-connection').onclick = () => modal.classList.add('open');
  document.getElementById('conn-modal-close').onclick = () => modal.classList.remove('open');
  document.getElementById('conn-cancel').onclick = () => modal.classList.remove('open');
  document.getElementById('conn-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    try {
      const r = await fetch('/api/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.ok) {
        updateConnectionUI(data);
        addMessage(`Conectado com sucesso ao PostgreSQL: ${data.user}@${data.host}:${data.port}/${data.database}`, 'ok');
        await refreshLiveSchema();
        modal.classList.remove('open');
      } else {
        addMessage(`Falha na conexão PostgreSQL: ${data.error}`, 'err');
        ide.activeOutputTab = 'messages';
      }
    } catch {
      addMessage('Servidor Node.js não está rodando. Execute "npm install && npm start" dentro da pasta server/.', 'err');
      ide.activeOutputTab = 'messages';
    }
    renderOutput();
  };

  initResizer();
  renderExplorer();
  createTab('vw_espelho_ponto_detalhado', '-- Bem-vindo ao PG Studio (Time Tracking Database System)\n-- Pressione Ctrl+Enter ou F5 para executar qualquer comando SQL\nSELECT * FROM vw_espelho_ponto_detalhado LIMIT 50;', true);
  await checkBackend();
});
