-- ============================================================================
-- TESTE 08: Smoke Test das 5 Views oficiais do projeto
-- ============================================================================

-- Amostra individual (descomente qualquer linha ou selecione e clique em "▷ Seleção")
-- SELECT * FROM vw_espelho_ponto_detalhado ORDER BY work_date DESC, employee_id LIMIT 10;
-- SELECT * FROM vw_resumo_banco_horas_colaboradores ORDER BY balance_minutes DESC LIMIT 10;
-- SELECT * FROM vw_relatorio_inconsistencias_ponto ORDER BY work_date DESC LIMIT 10;
-- SELECT * FROM vw_demonstrativo_adicional_noturno ORDER BY night_minutes DESC LIMIT 10;
-- SELECT * FROM vw_escalas_jornadas_vigentes ORDER BY employee_id LIMIT 10;

-- Resumo consolidado das 5 Views (exibe todas as contagens em uma única grade)
SELECT 'vw_espelho_ponto_detalhado'          AS view_name, COUNT(*) AS total_registros FROM vw_espelho_ponto_detalhado
UNION ALL
SELECT 'vw_resumo_banco_horas_colaboradores' AS view_name, COUNT(*) AS total_registros FROM vw_resumo_banco_horas_colaboradores
UNION ALL
SELECT 'vw_relatorio_inconsistencias_ponto'  AS view_name, COUNT(*) AS total_registros FROM vw_relatorio_inconsistencias_ponto
UNION ALL
SELECT 'vw_demonstrativo_adicional_noturno'  AS view_name, COUNT(*) AS total_registros FROM vw_demonstrativo_adicional_noturno
UNION ALL
SELECT 'vw_escalas_jornadas_vigentes'        AS view_name, COUNT(*) AS total_registros FROM vw_escalas_jornadas_vigentes;
