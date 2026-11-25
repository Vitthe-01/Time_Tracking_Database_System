-- ============================================================================
-- TESTE 01: Funções Auxiliares (fn_distance_meters, fn_night_minutes, fn_refresh_daily_summary)
-- ============================================================================

-- Executa o recálculo idempotente do resumo diário do Colaborador #21 (2026-10-19)
SELECT fn_refresh_daily_summary(21, DATE '2026-10-19');

-- Painel unificado com os resultados de TODAS as 3 funções auxiliares
SELECT 'fn_distance_meters (mesmo ponto)' AS teste,
       fn_distance_meters(-23.55052, -46.633308, -23.55052, -46.633308)::text || ' m' AS resultado,
       '0.00 m' AS esperado
UNION ALL
SELECT 'fn_distance_meters (dentro do raio 200m)',
       fn_distance_meters(-23.55052, -46.633308, -23.55152, -46.633308)::text || ' m',
       '~111.19 m (< 200m)'
UNION ALL
SELECT 'fn_distance_meters (SP -> RJ, fora do raio)',
       fn_distance_meters(-23.55052, -46.633308, -22.90680, -43.172900)::text || ' m',
       '~360000 m (> 200m)'
UNION ALL
SELECT 'fn_night_minutes (08:00 -> 17:00 diurno)',
       fn_night_minutes(TIMESTAMP '2026-10-19 08:00:00', TIMESTAMP '2026-10-19 17:00:00')::text || ' min',
       '0 min'
UNION ALL
SELECT 'fn_night_minutes (14:00 -> 23:00 parcial)',
       fn_night_minutes(TIMESTAMP '2026-10-19 14:00:00', TIMESTAMP '2026-10-19 23:00:00')::text || ' min',
       '60 min'
UNION ALL
SELECT 'fn_night_minutes (22:00 -> 05:00 madrugada)',
       fn_night_minutes(TIMESTAMP '2026-10-19 22:00:00', TIMESTAMP '2026-10-20 05:00:00')::text || ' min',
       '420 min'
UNION ALL
SELECT 'fn_refresh_daily_summary (Colab #21 em 2026-10-19)',
       'worked=' || worked_minutes || 'm, overtime=' || overtime_minutes || 'm, late=' || late_minutes || 'm',
       'resumo recalculado em daily_summary'
  FROM daily_summary
 WHERE employee_id = 21
   AND work_date = DATE '2026-10-19';
