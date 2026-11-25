-- ============================================================================
-- DEMO 02 (2,5 min): CRUD + Functions + 5 Procedures + 5 Triggers ao Vivo
-- ============================================================================

DO $$
DECLARE
    v_esc_id integer;
BEGIN
    -- 1. DDL + CRUD rápido (CREATE -> INSERT -> UPDATE -> DELETE -> DROP)
    CREATE TEMP TABLE demo_note (id serial PRIMARY KEY, emp_id int REFERENCES employee(employee_id), txt text NOT NULL);
    INSERT INTO demo_note (emp_id, txt) VALUES (21, 'Criado');
    UPDATE demo_note SET txt = 'Editado' WHERE emp_id = 21;
    DELETE FROM demo_note WHERE emp_id = 21;
    DROP TABLE IF EXISTS demo_note;
    RAISE NOTICE '[1. DDL/CRUD] CREATE, INSERT, UPDATE, DELETE e DROP executados.';

    -- 2. Functions auxiliares
    RAISE NOTICE '[2. FUNCTIONS] Distância SP->RJ = % m | Noturno 22h-05h = % min',
        fn_distance_meters(-23.55052, -46.633308, -22.90680, -43.172900),
        fn_night_minutes(TIMESTAMP '2026-10-19 22:00:00', TIMESTAMP '2026-10-20 05:00:00');

    -- 3. sp_registrar_marcacao_ponto + Triggers (intervalo <5m, geo/CIDR, espelho fechado)
    IF NOT EXISTS (SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 08:05:00') THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 1, TIMESTAMP '2026-10-28 08:05:00', -22.906800, -43.172900, INET '10.10.21.15');
    END IF;
    BEGIN
        CALL sp_registrar_marcacao_ponto(21, 21, 2, TIMESTAMP '2026-10-28 08:07:00', -22.906800, -43.172900, INET '10.10.21.15');
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[3a. TRIGGER 1 - <5min] %', SQLERRM; END;

    IF NOT EXISTS (SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 17:05:00') THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 4, TIMESTAMP '2026-10-28 17:05:00', -23.550520, -46.633308, INET '189.45.20.99');
        RAISE NOTICE '[3b. TRIGGER 2 - GEO/CIDR] Alertas gravados em punch_audit.';
    END IF;
    BEGIN
        CALL sp_registrar_marcacao_ponto(1, 1, 1, TIMESTAMP '2026-10-28 08:05:00', -23.550520, -46.633308, INET '10.10.1.15');
    EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[3c. TRIGGER 3 - ESPELHO FECHADO] %', SQLERRM; END;

    -- 4. Abono (dispara Trigger 5: waiver_audit) + Banco de Horas (Trigger 4)
    CALL sp_abonar_falta_atraso(21, DATE '2026-10-19', DATE '2026-10-21', 1, 'ATESTADO-DEMO.pdf', 'rh.luis', 'Abono na demo');
    CALL sp_recalcular_banco_horas(5, DATE '2026-10-19', DATE '2026-10-31');
    RAISE NOTICE '[4. ABONO + BANCO] sp_abonar_falta_atraso (waiver_audit) e sp_recalcular_banco_horas OK.';

    -- 5. Troca de escala + Fechamento mensal (Jan/2026 Colab #22)
    INSERT INTO work_schedule (employer_id, name, daily_minutes, tolerance_minutes) VALUES (1, 'Escala Demo 09-18', 480, 5) ON CONFLICT DO NOTHING;
    SELECT work_schedule_id INTO v_esc_id FROM work_schedule WHERE employer_id = 1 AND name = 'Escala Demo 09-18';
    INSERT INTO work_schedule_day (work_schedule_id, weekday, day_off, entry_time, break_start_time, break_end_time, exit_time)
    SELECT v_esc_id, w, (w IN (0,6)), CASE WHEN w IN (0,6) THEN NULL ELSE TIME '09:00' END, CASE WHEN w IN (0,6) THEN NULL ELSE TIME '13:00' END, CASE WHEN w IN (0,6) THEN NULL ELSE TIME '14:00' END, CASE WHEN w IN (0,6) THEN NULL ELSE TIME '18:00' END
      FROM generate_series(0,6) AS w ON CONFLICT DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM employee_schedule_history WHERE employee_id = 1 AND work_schedule_id = v_esc_id) THEN
        CALL sp_vincular_escala_trabalho(v_esc_id, ARRAY[1], DATE '2026-11-01');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM timesheet WHERE employee_id = 22 AND start_date = DATE '2026-01-01') THEN
        CALL sp_registrar_marcacao_ponto(22, 22, 1, TIMESTAMP '2026-01-15 08:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_registrar_marcacao_ponto(22, 22, 4, TIMESTAMP '2026-01-15 17:00:00', -22.88333, -43.10361, INET '10.10.22.10');
        CALL sp_fechar_espelho_ponto_mensal(22, 2026, 1);
    END IF;
    RAISE NOTICE '[5. ESCALA + FECHAMENTO] sp_vincular_escala_trabalho e sp_fechar_espelho_ponto_mensal OK.';
END $$;

-- Conferência imediata das auditorias geradas pelos Triggers
SELECT 'punch_audit' AS auditoria, alert_type AS evento, description AS detalhe FROM punch_audit WHERE employee_id = 21
UNION ALL
SELECT 'waiver_audit', operation, responsible_user || ' - ' || detail FROM waiver_audit WHERE employee_id = 21;
