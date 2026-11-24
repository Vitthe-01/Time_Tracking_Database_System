-- ============================================================================
-- TESTE 03: sp_abonar_falta_atraso + Trigger tg_auditoria_justificativas_abono
-- Testa:
--   1. Rejeição quando documento comprobatório não é informado
--   2. Bloqueio quando período está em espelho fechado e assinado (Colaborador #1)
--   3. Registro de abono válido (Colaborador #21) + auditoria automática em waiver_audit
-- ============================================================================

DO $$
BEGIN
    -- CASO 1: Documento vazio (deve falhar)
    BEGIN
        CALL sp_abonar_falta_atraso(
            21, DATE '2026-10-19', DATE '2026-10-21',
            1, '   ', 'rh.luis', 'Teste sem documento'
        );
        RAISE WARNING '[FALHA] Caso 1: Deveria exigir documento comprobatório!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 1 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 2: Período coberto por espelho fechado (Colaborador #1)
    BEGIN
        CALL sp_abonar_falta_atraso(
            1, DATE '2026-10-19', DATE '2026-10-21',
            1, 'ATESTADO-BLOQUEADO.pdf', 'rh.luis', 'Tentativa em espelho fechado'
        );
        RAISE WARNING '[FALHA] Caso 2: Deveria bloquear abono em espelho fechado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 2 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 3: Abono válido para Colaborador #21 (espelho aberto)
    CALL sp_abonar_falta_atraso(
        21, DATE '2026-10-19', DATE '2026-10-21',
        1, 'ATESTADO-MED-2026-TESTE.pdf', 'rh.luis', 'Atestado médico validado na apresentação'
    );
    RAISE NOTICE '[OK] Caso 3: Abono registrado e auditado via tg_auditoria_justificativas_abono.';
END $$;

-- Verifica o registro criado em absence_waiver e a trilha automática em waiver_audit
SELECT w.absence_waiver_id, w.employee_id, w.document, w.waived_minutes,
       a.waiver_audit_id, a.operation, a.responsible_user, a.audited_at, a.detail
  FROM absence_waiver w
  JOIN waiver_audit a ON a.absence_waiver_id = w.absence_waiver_id
 WHERE w.employee_id = 21
 ORDER BY a.waiver_audit_id DESC
 LIMIT 5;
