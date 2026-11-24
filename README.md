# Time Tracking Database System

## Descrição do projeto

Banco de dados relacional em PostgreSQL para controle de jornada e ponto eletrônico (REP-P). O sistema reúne empregadores, departamentos, locais de trabalho com raio e rede permitidos, colaboradores, dispositivos, escalas, marcações, resumo diário, banco de horas, espelho de ponto mensal, ajustes, abonos, falhas de biometria e auditorias.

## Objetivo da solução

Registrar a marcação de ponto com integridade referencial, apurar horas trabalhadas, horas extras, atrasos, adicional noturno e faltas, e fechar o espelho do mês sem permitir alteração depois da assinatura. DDL, DML, procedures, functions, triggers, views e consultas trabalham sobre o mesmo modelo.

## Integrantes

- Matheus da Costa Pereira
- Luis Filipe Silva Lima
- Brendha Maria Costa Seixas

## Estrutura de pastas

```
time-tracking-database-system/
  README.md
  install.sql                  executa todos os scripts na ordem
  ddl/                         01_cleanup, 02_tables, 03_indexes
  dml/                         um arquivo por tabela (01 a 25) e 26_sequences
  procedures_functions/        funções auxiliares, funções de trigger e as 5 procedures
  triggers/                    os 5 triggers
  views/                       as 5 views
  dql/                         as 20 consultas, numeradas de 01 a 20
  Tests/                       suíte com 8 scripts SQL de teste (functions, procedures, triggers, views e CRUD)
  interface/                   PG Studio (IDE Web PostgreSQL: index.html, styles.css, app.js, data.js)
  server/                      backend Node.js + Express + pg para executar SQL real no PostgreSQL
```

## Resumo do modelo

**Tabelas auxiliares** (3 ou mais registros): `device_type`, `punch_type`, `timesheet_status`, `record_status`, `adjustment_type`, `waiver_type` e `job_title`.

**Tabelas principais** (30 ou mais registros): `employer`, `department`, `work_location`, `employee`, `device`, `work_schedule`, `work_schedule_day`, `employee_schedule_history`, `time_punch`, `daily_summary`, `hour_bank_movement`, `hour_bank`, `timesheet`, `biometric_failure`, `punch_audit`, `punch_adjustment`, `absence_waiver` e `waiver_audit`.

Os dados cobrem as duas últimas semanas de outubro de 2026 (19 a 31/10), com 30 colaboradores em 30 empregadores. O espelho mensal segue de 01 a 31/10. As tabelas derivadas (`daily_summary`, `hour_bank_movement`, `hour_bank`, `timesheet`, `punch_audit`, `absence_waiver` e `waiver_audit`) foram geradas pelas próprias procedures, functions e triggers do banco. O IP da marcação usa `INET` e a rede permitida do local usa `CIDR`.

## Procedures

- `sp_registrar_marcacao_ponto`: grava a marcação, sinaliza divergência de raio e de rede e atualiza o resumo diário.
- `sp_fechar_espelho_ponto_mensal`: soma o resumo diário de um mês já encerrado, fecha e assina o espelho.
- `sp_abonar_falta_atraso`: exige documento, registra o abono e recalcula o resumo diário e os espelhos abertos.
- `sp_recalcular_banco_horas`: refaz os movimentos e o saldo do banco de horas de um período.
- `sp_vincular_escala_trabalho`: vincula uma escala a um grupo de colaboradores, recusando conflito de vigência.

## Triggers

- `tg_validar_intervalo_minimo_marcacoes`: bloqueia duas marcações do mesmo colaborador com menos de 5 minutos de diferença.
- `tg_alertar_divergencia_geolocalizacao`: grava auditoria quando a marcação está fora do raio do local.
- `tg_bloquear_alteracao_espelho_fechado`: impede inclusão, alteração e exclusão de marcações em espelho fechado e assinado.
- `tg_atualizar_banco_horas_diario`: atualiza movimento e saldo do banco de horas quando o resumo do dia muda.
- `tg_auditoria_justificativas_abono`: audita inclusão e alteração de abono com o usuário responsável.

## Views

- `vw_espelho_ponto_detalhado`: espelho diário com horários das marcações, atraso e hora extra.
- `vw_resumo_banco_horas_colaboradores`: saldo e vencimento do banco de horas dos colaboradores ativos por departamento.
- `vw_relatorio_inconsistencias_ponto`: alertas de auditoria, dias com marcações ímpares e intervalos insuficientes.
- `vw_demonstrativo_adicional_noturno`: minutos e horas trabalhados entre 22h e 5h por colaborador e mês.
- `vw_escalas_jornadas_vigentes`: escala vigente de cada colaborador ativo, com horários e dias de folga.

## PG Studio — Interface IDE PostgreSQL (`interface/` e `server/`)

O projeto conta com uma **IDE Web para PostgreSQL** (inspirada no pgAdmin / DBeaver) pensada para executar e demonstrar todo o **core do banco de dados** diretamente pelo navegador:

- **Object Explorer**: árvore lateral com todas as **25 Tabelas**, **5 Views**, **20 Consultas DQL**, **13 Procedures/Functions**, **5 Triggers** e **3 Scripts DDL** com filtro rápido.
- **Query Editor com múltiplas abas**: editor SQL com numeração de linhas, atalhos `Ctrl+Enter` / `F5`, execução de trecho selecionado e snippets prontos (`CALL sp_...`) para testar procedures e triggers.
- **Painel de Saída redimensionável**:
  - **Data Output**: grade de resultados com filtro em tempo real, contagem de linhas, tempo de execução (`ms`) e exportação para **CSV**.
  - **Messages**: console com saídas, `NOTICE`, `SQLSTATE`, `DETAIL` e mensagens de `RAISE EXCEPTION` dos triggers.
  - **Structure**: inspeção de colunas, tipos e constraints das tabelas.
  - **History**: histórico clicável das queries executadas na sessão.
- **Botão "Rodar Core do Projeto"**: executa todos os scripts do repositório na ordem correta (`DDL` → `DML` → `Procedures_Functions` → `Triggers` → `Views`) direto no PostgreSQL.
- **Modal de Conexão**: permite configurar `host`, `port`, `database`, `user` e `password` diretamente pela interface.

### 1. Executando com PostgreSQL real (recomendado para rodar o core)
```bash
cd server
cp .env.example .env   # opcional: também é possível configurar pela própria interface
npm install
npm start
```
Abra `http://localhost:3000` no navegador, clique no botão de conexão no canto superior direito (se precisar ajustar usuário/senha/banco) e clique em **Rodar Core do Projeto** para instalar tudo e executar queries reais no PostgreSQL.

### 2. Modo Offline (sem instalar Node.js nem PostgreSQL)
Basta abrir o arquivo `interface/index.html` diretamente no navegador. A IDE carrega automaticamente o **Engine Local** com os dados reais extraídos da pasta `DML/`, suportando `SELECT`, as 5 Views, os 20 scripts `DQL/` e testes de `CALL sp_...`.

## Suíte de Testes SQL (`Tests/`)

Para testar todas as funções, procedures, triggers e views durante a apresentação, execute os scripts na ordem numérica (diretamente pelo grupo **🧪 Scripts de Teste** no PG Studio, no pgAdmin ou via `psql`):

1. `Tests/01_test_functions_auxiliares.sql` — testa `fn_distance_meters`, `fn_night_minutes` e `fn_refresh_daily_summary`.
2. `Tests/02_test_registrar_ponto_e_triggers.sql` — testa `sp_registrar_marcacao_ponto`, bloqueio de intervalo mínimo (`< 5 min`), alertas de geolocalização e rede CIDR em `punch_audit`, bloqueio em espelho fechado e validação de dispositivo.
3. `Tests/03_test_abono_e_auditoria.sql` — testa `sp_abonar_falta_atraso` (exigência de documento, bloqueio em espelho fechado e abono válido) + trigger `tg_auditoria_justificativas_abono` em `waiver_audit`.
4. `Tests/04_test_fechar_espelho_e_bloqueio.sql` — testa `sp_fechar_espelho_ponto_mensal` (rejeição de mês futuro, fechamento real em mês encerrado `2026-01`, bloqueio de duplo fechamento e bloqueio pós-fechamento).
5. `Tests/05_test_banco_horas_e_trigger.sql` — testa `sp_recalcular_banco_horas` e `tg_atualizar_banco_horas_diario`.
6. `Tests/06_test_vincular_escala_trabalho.sql` — testa `sp_vincular_escala_trabalho` (empregador diferente, vínculo duplicado e troca de escala com encerramento de vigência anterior).
7. `Tests/07_test_todas_views_e_dql_smoke.sql` — smoke test consolidado das 5 Views oficiais.
8. `Tests/08_test_crud_inserir_editar_excluir.sql` — testa **INSERT, UPDATE e DELETE** em cadastros (`department`, `punch_adjustment`), auditoria de `UPDATE` em `absence_waiver`, edição/exclusão permitida vs bloqueada em `time_punch` (espelho aberto vs fechado) e integridade referencial (`ON DELETE RESTRICT`).



