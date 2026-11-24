-- ============================================================================
-- TESTE 01: Funções Auxiliares (fn_distance_meters, fn_night_minutes, fn_refresh_daily_summary)
-- ============================================================================

-- 1. Teste de fn_distance_meters (Cálculo de distância Haversine em metros)
SELECT
    fn_distance_meters(-23.55052, -46.633308, -23.55052, -46.633308)  AS distancia_mesmo_ponto_m,
    fn_distance_meters(-23.55052, -46.633308, -23.55152, -46.633308)  AS distancia_dentro_raio_200m,
    fn_distance_meters(-23.55052, -46.633308, -22.90680, -43.172900)  AS distancia_sp_para_rj_m;

-- 2. Teste de fn_night_minutes (Minutos trabalhados entre 22:00 e 05:00)
SELECT
    fn_night_minutes(TIMESTAMP '2026-10-19 08:00:00', TIMESTAMP '2026-10-19 17:00:00') AS turno_diurno_esperado_0,
    fn_night_minutes(TIMESTAMP '2026-10-19 14:00:00', TIMESTAMP '2026-10-19 23:00:00') AS turno_parcial_esperado_60,
    fn_night_minutes(TIMESTAMP '2026-10-19 22:00:00', TIMESTAMP '2026-10-20 05:00:00') AS turno_madrugada_esperado_420;

-- 3. Teste de fn_refresh_daily_summary (Recálculo idempotente do resumo diário do Colaborador #21)
SELECT fn_refresh_daily_summary(21, DATE '2026-10-19');

SELECT employee_id, work_date, scheduled_minutes, worked_minutes, overtime_minutes, late_minutes, night_minutes
  FROM daily_summary
 WHERE employee_id = 21
   AND work_date = DATE '2026-10-19';
