-- ============================================================================
-- DEMO 03: Abonos, Banco de Horas, Escalas e Fechamento Mensal
-- Demonstra:
--   • sp_abonar_falta_atraso + tg_auditoria_justificativas_abono (waiver_audit)
--   • sp_recalcular_banco_horas + tg_atualizar_banco_horas_diario
--   • sp_vincular_escala_trabalho
--   • sp_fechar_espelho_ponto_mensal + bloqueio pós-fechamento
-- ============================================================================

DO $$
DECLARE
    v_new_schedule_id integer;
BEGIN
    -- 1. Abono com documento -> dispara tg_auditoria_justificativas_abono
    CALL sp_abonar_falta_atraso(21, DATE '2026-10-19', DATE '2026-10-21', 1, 'ATESTADO-DEMO.pdf', 'rh.luis', 'Abono demonstrado ao vivo');
    RAISE NOTICE '[OK] sp_abonar_falta_atraso + tg_auditoria_justificativas_abono executados.';

    -- 2. Recálculo do banco de horas
    CALL sp_recalcular_banco_horas(5, DATE '2026-10-19', DATE '2026-10-31');
    RAISE NOTICE '[OK] sp_recalcular_banco_horas + tg_atualizar_banco_horas_diario validados.';

    -- 3. Vínculo de nova escala de trabalho (encerra vigência anterior)
    INSERT INTO work_schedule (employer_id, name, daily_minutes, tolerance_minutes)
    VALUES (1, 'Escala Demo 09-18', 480, 5)
    ON CONFLICT (employer_id, name) DO NOTHING;

    SELECT work_schedule_id INTO v_new_schedule_id FROM work_schedule WHERE employer_id = 1 AND name = 'Escala Demo 09-18';

    INSERT INTO work_schedule_day (work_schedule_id, weekday, day_off, entry_time, break_start_time, break_end_time, exit_time)
    VALUES
        (v_new_schedule_id, 0, TRUE,  NULL,         NULL,         NULL,         NULL),
        (v_new_schedule_id, 1, FALSE, TIME '09:00', TIME '13:00', TIME '14:00', TIME '18:00'),
        (v_new_schedule_id, 2, FALSE, TIME '09:00', TIME '13:00', TIME '14:00', TIME '18:00'),
        (v_new_schedule_id, 3, FALSE, TIME '09:00', TIME '13:00', TIME '14:00', TIME '18:00'),
        (v_new_schedule_id, 4, FALSE, TIME '09:00', TIME '13:00', TIME '14:00', TIME '18:00'),
        (v_new_schedule_id, 5, FALSE, TIME '09:00', TIME '13:00', TIME '14:00', TIME '18:00'),
        (v_new_schedule_id, 6, TRUE,  NULL,         NULL,         NULL,         NULL)
    ON CONFLICT (work_schedule_id, weekday) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM employee_schedule_history WHERE employee_id = 1 AND work_schedule_id = v_new_schedule_id) THEN
        CALL sp_vincular_escala_trabalho(v_new_schedule_id, ARRAY[1], DATE '2026-11-01');
        RAISE NOTICE '[OK] sp_vincular_escala_trabalho vinculou nova escala ao Colab #1.';
    END IF;

    -- 4. Fechamento mensal em mês já encerrado (Jan/2026 - Colab #22) + bloqueio posterior
    IF NOT EXISTS (SELECT 1 FROM timesheet WHERE employee_id = 22 AND start_date = DATE '2026-01-01') THEN
        CALL sp_registrar_marcacao_ponto(22, 22, 1, TIMESTAMP '2026-01-15 08:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 2, TIMESTAMP '2026-01-15 12:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 3, TIMESTAMP '2026-01-15 13:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 4, TIMESTAMP '2026-01-15 17:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_fechar_espelho_ponto_mensal(22, 2026, 1);
        RAISE NOTICE '[OK] sp_fechar_espelho_ponto_mensal fechou e assinou Jan/2026 (Colab #22).';
    END IF;

    BEGIN
        CALL sp_registrar_marcacao_ponto(22, 22, 1, TIMESTAMP '2026-01-16 08:00:00', -22.88333, -43.10361, INET '10.10.22.10');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Pós-fechamento bloqueado automaticamente: %', SQLERRM;
    END;
END $$;

-- Trilha automática de auditoria de abonos (waiver_audit)
SELECT waiver_audit_id, employee_id, operation, responsible_user, audited_at, detail
  FROM waiver_audit
 ORDER BY waiver_audit_id DESC
 LIMIT 5;
