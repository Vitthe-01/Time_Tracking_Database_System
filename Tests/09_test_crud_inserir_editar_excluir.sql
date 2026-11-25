-- ============================================================================
-- TESTE 09: CRUD Completo (INSERT, UPDATE e DELETE) + Triggers de Edição/Exclusão
-- Testa:
--   1. INSERT e UPDATE em tabela cadastral (department) + limpeza opcional
--   2. INSERT e UPDATE em punch_adjustment (ajuste manual de ponto)
--   3. UPDATE em absence_waiver disparando tg_auditoria_justificativas_abono (operação 'update')
--   4. UPDATE e DELETE em time_punch permitido em espelho ABERTO (Colaborador #21)
--   5. UPDATE e DELETE em time_punch BLOQUEADO em espelho FECHADO (Colaborador #1)
--   6. Proteção de integridade referencial (ON DELETE RESTRICT) ao tentar excluir empregador em uso
-- ============================================================================

DO $$
DECLARE
    v_dept_id integer;
    v_adj_id integer;
    v_waiver_id integer;
    v_punch_id integer;
BEGIN
    -- 1. INSERT + UPDATE em department (cadastro, idempotente para re-execução)
    SELECT department_id INTO v_dept_id
      FROM department
     WHERE employer_id = 1
       AND name IN ('Engenharia de Dados (Teste)', 'Engenharia de Dados (Editado)')
     LIMIT 1;

    IF v_dept_id IS NULL THEN
        INSERT INTO department (employer_id, name)
        VALUES (1, 'Engenharia de Dados (Teste)')
        RETURNING department_id INTO v_dept_id;
    END IF;

    UPDATE department
       SET name = 'Engenharia de Dados (Editado)'
     WHERE department_id = v_dept_id;
    RAISE NOTICE '[OK] Caso 1: INSERT e UPDATE em department (id = %).', v_dept_id;

    -- 2. INSERT + UPDATE em punch_adjustment (ajuste manual de ponto)
    INSERT INTO punch_adjustment (
        employee_id, adjustment_type_id, record_status_id, adjustment_date, reference_at, reason
    ) VALUES (
        21, 1, 1, DATE '2026-10-28', TIMESTAMP '2026-10-28 08:00:00',
        'Solicitação inicial de ajuste (Teste CRUD)'
    )
    RETURNING punch_adjustment_id INTO v_adj_id;

    UPDATE punch_adjustment
       SET record_status_id = (SELECT record_status_id FROM record_status WHERE name = 'Approved'),
           reason = 'Ajuste aprovado pelo gestor após conferência (Teste CRUD)'
     WHERE punch_adjustment_id = v_adj_id;
    RAISE NOTICE '[OK] Caso 2: INSERT e UPDATE em punch_adjustment (id = %).', v_adj_id;

    -- 3. UPDATE em absence_waiver -> dispara tg_auditoria_justificativas_abono (operation = 'update')
    SELECT absence_waiver_id INTO v_waiver_id
      FROM absence_waiver
     WHERE employee_id = 21
     ORDER BY absence_waiver_id DESC
     LIMIT 1;

    IF v_waiver_id IS NOT NULL THEN
        UPDATE absence_waiver
           SET description = 'Descrição editada na apresentação (dispara auditoria de UPDATE)'
         WHERE absence_waiver_id = v_waiver_id;
        RAISE NOTICE '[OK] Caso 3: UPDATE em absence_waiver (id = %) auditado em waiver_audit.', v_waiver_id;
    END IF;

    -- 4. INSERT + UPDATE + DELETE em time_punch num espelho ABERTO (Colaborador #21)
    INSERT INTO time_punch (
        employer_id, employee_id, device_id, punch_type_id, sequence_number,
        punched_at, latitude, longitude, ip_address, outside_perimeter
    ) VALUES (
        21, 21, 21, 1,
        (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM time_punch),
        TIMESTAMP '2026-10-30 08:00:00', -22.906800, -43.172900, INET '10.10.21.15', FALSE
    )
    RETURNING time_punch_id INTO v_punch_id;

    UPDATE time_punch
       SET punched_at = TIMESTAMP '2026-10-30 08:02:00'
     WHERE time_punch_id = v_punch_id;

    DELETE FROM time_punch
     WHERE time_punch_id = v_punch_id;
    RAISE NOTICE '[OK] Caso 4: INSERT, UPDATE e DELETE em time_punch permitidos em espelho aberto.';

    -- 5. UPDATE e DELETE em time_punch num espelho FECHADO (Colaborador #1) -> deve BLOQUEAR
    BEGIN
        UPDATE time_punch
           SET punched_at = punched_at + INTERVAL '10 minutes'
         WHERE time_punch_id = 1;
        RAISE WARNING '[FALHA] Caso 5a: Deveria bloquear UPDATE em espelho fechado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 5a (UPDATE bloqueado em espelho fechado): %', SQLERRM;
    END;

    BEGIN
        DELETE FROM time_punch
         WHERE time_punch_id = 1;
        RAISE WARNING '[FALHA] Caso 5b: Deveria bloquear DELETE em espelho fechado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 5b (DELETE bloqueado em espelho fechado): %', SQLERRM;
    END;

    -- 6. Integridade Referencial (ON DELETE RESTRICT)
    BEGIN
        DELETE FROM employer WHERE employer_id = 1;
        RAISE WARNING '[FALHA] Caso 6: Deveria impedir exclusão de empregador com vínculos!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 6 (ON DELETE RESTRICT funcionando): %', SQLERRM;
    END;
END $$;

-- Verificação das auditorias de INSERT e UPDATE em waiver_audit
SELECT waiver_audit_id, absence_waiver_id, employee_id, operation, responsible_user, audited_at, detail
  FROM waiver_audit
 WHERE employee_id = 21
 ORDER BY waiver_audit_id DESC
 LIMIT 6;
