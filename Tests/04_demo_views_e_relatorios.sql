-- ============================================================================
-- DEMO 04: Painel Final — Conferência das 5 Views Oficiais
-- ============================================================================

SELECT 'vw_espelho_ponto_detalhado'          AS view_oficial, COUNT(*) AS total_registros FROM vw_espelho_ponto_detalhado
UNION ALL
SELECT 'vw_resumo_banco_horas_colaboradores' AS view_oficial, COUNT(*) AS total_registros FROM vw_resumo_banco_horas_colaboradores
UNION ALL
SELECT 'vw_relatorio_inconsistencias_ponto'  AS view_oficial, COUNT(*) AS total_registros FROM vw_relatorio_inconsistencias_ponto
UNION ALL
SELECT 'vw_demonstrativo_adicional_noturno'  AS view_oficial, COUNT(*) AS total_registros FROM vw_demonstrativo_adicional_noturno
UNION ALL
SELECT 'vw_escalas_jornadas_vigentes'        AS view_oficial, COUNT(*) AS total_registros FROM vw_escalas_jornadas_vigentes;
