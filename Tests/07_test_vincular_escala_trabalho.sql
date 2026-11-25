-- ============================================================================
-- TESTE 07: sp_vincular_escala_trabalho
-- Testa:
--   1. Rejeição de escala pertencente a outro empregador
--   2. Rejeição quando colaborador já está vinculado à mesma escala
--   3. Troca de escala encerrando vigência anterior em employee_schedule_history
-- ============================================================================

DO $$
DECLARE
    v_new_schedule_id integer;
BEGIN
    -- CASO 1: Escala #2 (Empregador 2) para Colaborador #1 (Empregador 1)
    BEGIN
        CALL sp_vincular_escala_trabalho(2, ARRAY[1], DATE '2026-11-01');
        RAISE WARNING '[FALHA] Caso 1: Deveria rejeitar escala de outro empregador!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 1 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 2: Vínculo duplicado na escala #1 (já vigente)
    BEGIN
        CALL sp_vincular_escala_trabalho(1, ARRAY[1], DATE '2026-10-15');
        RAISE WARNING '[FALHA] Caso 2: Deveria rejeitar vínculo duplicado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 2 bloqueado corretamente: %', SQLERRM;
    END;

    -- CASO 3: Cria nova escala para Empregador #1 e vincula ao Colaborador #1
    INSERT INTO work_schedule (employer_id, name, daily_minutes, tolerance_minutes)
    VALUES (1, 'Escala Comercial 09-18 (Teste)', 480, 5)
    ON CONFLICT (employer_id, name) DO NOTHING;

    SELECT work_schedule_id INTO v_new_schedule_id
      FROM work_schedule
     WHERE employer_id = 1
       AND name = 'Escala Comercial 09-18 (Teste)';

    -- Garante dias da semana cadastrados para a nova escala aparecer na view de escalas vigentes
    INSERT INTO work_schedule_day (work_schedule_id, weekday, day_off, entry_time, break_start_time, break_end_time, exit_time)
    VALUES
        (v_new_schedule_id, 0, TRUE,  NULL,          NULL,          NULL,          NULL),
        (v_new_schedule_id, 1, FALSE, TIME '09:00',  TIME '13:00',  TIME '14:00',  TIME '18:00'),
        (v_new_schedule_id, 2, FALSE, TIME '09:00',  TIME '13:00',  TIME '14:00',  TIME '18:00'),
        (v_new_schedule_id, 3, FALSE, TIME '09:00',  TIME '13:00',  TIME '14:00',  TIME '18:00'),
        (v_new_schedule_id, 4, FALSE, TIME '09:00',  TIME '13:00',  TIME '14:00',  TIME '18:00'),
        (v_new_schedule_id, 5, FALSE, TIME '09:00',  TIME '13:00',  TIME '14:00',  TIME '18:00'),
        (v_new_schedule_id, 6, TRUE,  NULL,          NULL,          NULL,          NULL)
    ON CONFLICT (work_schedule_id, weekday) DO NOTHING;

    IF NOT EXISTS (
        SELECT 1 FROM employee_schedule_history
         WHERE employee_id = 1 AND work_schedule_id = v_new_schedule_id
    ) THEN
        CALL sp_vincular_escala_trabalho(v_new_schedule_id, ARRAY[1], DATE '2026-11-01');
        RAISE NOTICE '[OK] Caso 3: Nova escala vinculada ao Colaborador #1 (vigência anterior encerrada em 2026-10-31).';
    ELSE
        RAISE NOTICE '[INFO] Colaborador #1 já está vinculado à escala de teste.';
    END IF;
END $$;

-- Histórico de escalas do Colaborador #1 (mostra encerramento da antiga + vigência da nova)
SELECT h.employee_schedule_history_id, e.name AS employee_name, s.name AS schedule_name,
       h.start_date, h.end_date
  FROM employee_schedule_history h
  JOIN employee e ON e.employee_id = h.employee_id
  JOIN work_schedule s ON s.work_schedule_id = h.work_schedule_id
 WHERE h.employee_id = 1
 ORDER BY h.start_date;
