-- ============================================================================
-- TESTE 05: sp_fechar_espelho_ponto_mensal + Bloqueio Pós-Fechamento
-- Testa:
--   1. Rejeição de fechamento de mês futuro (2099-12)
--   2. Fechamento real em mês já encerrado (2026-01) para Colaborador #22
--   3. Rejeição de fechamento duplicado no mesmo período
--   4. Comprovação de que tg_bloquear_alteracao_espelho_fechado bloqueia novas marcações
-- ============================================================================

DO $$
BEGIN
    -- CASO 1: Tentar fechar mês que ainda não encerrou
    BEGIN
        CALL sp_fechar_espelho_ponto_mensal(22, 2099, 12);
        RAISE WARNING '[FALHA] Caso 1: Deveria rejeitar mês futuro!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 1 bloqueado corretamente: %', SQLERRM;
    END;

    -- Prepara marcações em Jan/2026 (mês já encerrado) para o Colaborador #22 (admitido em 2024)
    IF NOT EXISTS (
        SELECT 1 FROM timesheet WHERE employee_id = 22 AND start_date = DATE '2026-01-01'
    ) THEN
        CALL sp_registrar_marcacao_ponto(22, 22, 1, TIMESTAMP '2026-01-15 08:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 2, TIMESTAMP '2026-01-15 12:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 3, TIMESTAMP '2026-01-15 13:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 4, TIMESTAMP '2026-01-15 17:00:00', -22.88333, -43.10361, INET '10.10.22.10');

        -- CASO 2: Fechar e assinar espelho de Jan/2026
        CALL sp_fechar_espelho_ponto_mensal(22, 2026, 1);
        RAISE NOTICE '[OK] Caso 2: Espelho de Jan/2026 do Colaborador #22 fechado e assinado.';
    ELSE
        RAISE NOTICE '[INFO] Espelho de Jan/2026 do Colaborador #22 já estava fechado.';
    END IF;

    -- CASO 3: Tentar fechar novamente o mesmo período
    BEGIN
        CALL sp_fechar_espelho_ponto_mensal(22, 2026, 1);
        RAISE WARNING '[FALHA] Caso 3: Deveria impedir duplo fechamento!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 3 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 4: Tentar bater ponto em Jan/2026 após o fechamento (bloqueado pelo trigger)
    BEGIN
        CALL sp_registrar_marcacao_ponto(22, 22, 1, TIMESTAMP '2026-01-16 08:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        RAISE WARNING '[FALHA] Caso 4: Deveria ter sido bloqueado por tg_bloquear_alteracao_espelho_fechado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 4 bloqueado após fechamento: %', SQLERRM;
    END;
END $$;

-- Consulta o espelho fechado de Jan/2026 do Colaborador #22
SELECT t.timesheet_id, e.name AS employee_name, s.name AS status,
       t.start_date, t.end_date, t.worked_minutes, t.overtime_minutes, t.closed_at, t.signed_at
  FROM timesheet t
  JOIN employee e ON e.employee_id = t.employee_id
  JOIN timesheet_status s ON s.timesheet_status_id = t.timesheet_status_id
 WHERE t.employee_id = 22
 ORDER BY t.start_date;
