-- ============================================================================
-- TESTE 05: sp_recalcular_banco_horas + Trigger tg_atualizar_banco_horas_diario
-- Testa:
--   1. Rejeição de período inválido (end_date < start_date)
--   2. Recálculo dos movimentos e saldo do banco de horas do Colaborador #5
--   3. Conferência na view vw_resumo_banco_horas_colaboradores
-- ============================================================================

DO $$
BEGIN
    -- CASO 1: Período inválido
    BEGIN
        CALL sp_recalcular_banco_horas(5, DATE '2026-10-31', DATE '2026-10-19');
        RAISE WARNING '[FALHA] Caso 1: Deveria rejeitar período invertido!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 1 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 2: Recálculo válido para o Colaborador #5
    CALL sp_recalcular_banco_horas(5, DATE '2026-10-19', DATE '2026-10-31');
    RAISE NOTICE '[OK] Caso 2: Banco de horas do Colaborador #5 recalculado com sucesso.';
END $$;

-- Movimentos diários do Colaborador #5
SELECT employee_id, movement_date, minutes
  FROM hour_bank_movement
 WHERE employee_id = 5
 ORDER BY movement_date;

-- Saldo consolidado na view oficial
SELECT *
  FROM vw_resumo_banco_horas_colaboradores
 WHERE employee_id = 5;
