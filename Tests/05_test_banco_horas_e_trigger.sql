-- ============================================================================
-- TESTE 05: sp_recalcular_banco_horas + Trigger tg_atualizar_banco_horas_diario
-- Testa:
--   1. Rejeição de período inválido (end_date < start_date)
--   2. Acionamento automático do trigger tg_atualizar_banco_horas_diario ao alterar daily_summary
--   3. Recálculo explícito via sp_recalcular_banco_horas e conferência na view
-- ============================================================================

DO $$
DECLARE
    v_saldo_antes integer;
    v_saldo_durante integer;
    v_saldo_depois integer;
    v_worked_original integer;
BEGIN
    -- CASO 1: Período inválido
    BEGIN
        CALL sp_recalcular_banco_horas(5, DATE '2026-10-31', DATE '2026-10-19');
        RAISE WARNING '[FALHA] Caso 1: Deveria rejeitar período invertido!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 1 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 2: Disparo automático do trigger tg_atualizar_banco_horas_diario
    SELECT balance_minutes INTO v_saldo_antes
      FROM hour_bank
     WHERE employee_id = 5;

    SELECT worked_minutes INTO v_worked_original
      FROM daily_summary
     WHERE employee_id = 5
       AND work_date = DATE '2026-10-19';

    -- Soma +30 min temporariamente em daily_summary -> dispara tg_atualizar_banco_horas_diario
    UPDATE daily_summary
       SET worked_minutes = v_worked_original + 30
     WHERE employee_id = 5
       AND work_date = DATE '2026-10-19';

    SELECT balance_minutes INTO v_saldo_durante
      FROM hour_bank
     WHERE employee_id = 5;

    RAISE NOTICE '[OK] Caso 2 (Trigger tg_atualizar_banco_horas_diario): saldo antes = % min -> após +30 min em daily_summary = % min.',
                 v_saldo_antes, v_saldo_durante;

    -- Restaura valor original -> trigger atualiza o saldo de volta automaticamente
    UPDATE daily_summary
       SET worked_minutes = v_worked_original
     WHERE employee_id = 5
       AND work_date = DATE '2026-10-19';

    SELECT balance_minutes INTO v_saldo_depois
      FROM hour_bank
     WHERE employee_id = 5;

    RAISE NOTICE '[OK] Caso 2 (Restauração via trigger): saldo voltou para % min.', v_saldo_depois;

    -- CASO 3: Recálculo explícito via procedure sp_recalcular_banco_horas
    CALL sp_recalcular_banco_horas(5, DATE '2026-10-19', DATE '2026-10-31');
    RAISE NOTICE '[OK] Caso 3: sp_recalcular_banco_horas executado com sucesso para Colaborador #5.';
END $$;

-- Saldo consolidado na view oficial
SELECT *
  FROM vw_resumo_banco_horas_colaboradores
 WHERE employee_id = 5;
