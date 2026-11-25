-- ============================================================================
-- FLUXO COMPLETO DE APRESENTAÇÃO (ROTEIRO PONTA A PONTA)
-- Aciona TODAS as peças do banco em sequência lógica:
--   • 3 Functions:  fn_distance_meters, fn_night_minutes, fn_refresh_daily_summary
--   • 5 Procedures: sp_registrar_marcacao_ponto, sp_abonar_falta_atraso,
--                   sp_recalcular_banco_horas, sp_fechar_espelho_ponto_mensal,
--                   sp_vincular_escala_trabalho
--   • 5 Triggers:   tg_validar_intervalo_minimo_marcacoes,
--                   tg_alertar_divergencia_geolocalizacao,
--                   tg_bloquear_alteracao_espelho_fechado,
--                   tg_atualizar_banco_horas_diario,
--                   tg_auditoria_justificativas_abono
--   • 5 Views:      todas consultadas no painel final
-- ============================================================================

DO $$
DECLARE
    v_dist_m numeric;
    v_night_m integer;
    v_saldo_antes integer;
    v_saldo_depois integer;
    v_new_schedule_id integer;
BEGIN
    RAISE NOTICE '================ INÍCIO DO FLUXO COMPLETO ================';

    -- ------------------------------------------------------------------------
    -- ETAPA 1: Functions auxiliares (fn_distance_meters e fn_night_minutes)
    -- ------------------------------------------------------------------------
    v_dist_m := fn_distance_meters(-22.906800, -43.172900, -23.550520, -46.633308);
    v_night_m := fn_night_minutes(TIMESTAMP '2026-10-19 22:00:00', TIMESTAMP '2026-10-20 05:00:00');
    RAISE NOTICE '[ETAPA 1 - FUNCTIONS] fn_distance_meters(RJ->SP) = % m | fn_night_minutes(22h-05h) = % min', v_dist_m, v_night_m;

    -- ------------------------------------------------------------------------
    -- ETAPA 2: Registro de ponto + Triggers de intervalo, geolocalização e rede
    -- ------------------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-29 08:00:00'
    ) THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 1, TIMESTAMP '2026-10-29 08:00:00', -22.906800, -43.172900, INET '10.10.21.15');
        RAISE NOTICE '[ETAPA 2a - PROCEDURE] sp_registrar_marcacao_ponto: Entrada válida registrada (Colab #21).';
    END IF;

    -- Aciona tg_validar_intervalo_minimo_marcacoes (< 5 min)
    BEGIN
        CALL sp_registrar_marcacao_ponto(21, 21, 2, TIMESTAMP '2026-10-29 08:02:00', -22.906800, -43.172900, INET '10.10.21.15');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ETAPA 2b - TRIGGER 1] tg_validar_intervalo_minimo_marcacoes BLOQUEOU: %', SQLERRM;
    END;

    -- Aciona tg_alertar_divergencia_geolocalizacao + alerta de rede CIDR
    IF NOT EXISTS (
        SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-29 17:00:00'
    ) THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 4, TIMESTAMP '2026-10-29 17:00:00', -23.550520, -46.633308, INET '189.45.20.99');
        RAISE NOTICE '[ETAPA 2c - TRIGGER 2] tg_alertar_divergencia_geolocalizacao + CIDR gravaram alertas em punch_audit.';
    END IF;

    -- Aciona fn_refresh_daily_summary diretamente
    PERFORM fn_refresh_daily_summary(21, DATE '2026-10-29');
    RAISE NOTICE '[ETAPA 2d - FUNCTION] fn_refresh_daily_summary recalculou o dia 2026-10-29 (Colab #21).';

    -- ------------------------------------------------------------------------
    -- ETAPA 3: Banco de horas (sp_recalcular_banco_horas + tg_atualizar_banco_horas_diario)
    -- ------------------------------------------------------------------------
    SELECT balance_minutes INTO v_saldo_antes FROM hour_bank WHERE employee_id = 21;
    CALL sp_recalcular_banco_horas(21, DATE '2026-10-19', DATE '2026-10-31');
    SELECT balance_minutes INTO v_saldo_depois FROM hour_bank WHERE employee_id = 21;
    RAISE NOTICE '[ETAPA 3 - PROC + TRIGGER 4] sp_recalcular_banco_horas + tg_atualizar_banco_horas_diario | Saldo Colab #21: % -> % min',
                 v_saldo_antes, v_saldo_depois;

    -- ------------------------------------------------------------------------
    -- ETAPA 4: Abono de falta/atraso + Trigger de auditoria (INSERT e UPDATE)
    -- ------------------------------------------------------------------------
    CALL sp_abonar_falta_atraso(
        21, DATE '2026-10-19', DATE '2026-10-20',
        1, 'DOC-FLUXO-APRESENTACAO.pdf', 'rh.luis', 'Abono registrado no fluxo de apresentação'
    );
    RAISE NOTICE '[ETAPA 4 - PROC + TRIGGER 5] sp_abonar_falta_atraso + tg_auditoria_justificativas_abono executados (waiver_audit gravado).';

    -- ------------------------------------------------------------------------
    -- ETAPA 5: Fechamento de espelho mensal + Trigger de bloqueio pós-assinatura
    -- ------------------------------------------------------------------------
    IF NOT EXISTS (
        SELECT 1 FROM timesheet WHERE employee_id = 23 AND start_date = DATE '2026-02-01'
    ) THEN
        CALL sp_registrar_marcacao_ponto(23, 23, 1, TIMESTAMP '2026-02-10 08:00:00', -20.315500, -40.312800, INET '10.10.23.10');
        CALL sp_registrar_marcacao_ponto(23, 23, 2, TIMESTAMP '2026-02-10 12:00:00', -20.315500, -40.312800, INET '10.10.23.10');
        CALL sp_registrar_marcacao_ponto(23, 23, 3, TIMESTAMP '2026-02-10 13:00:00', -20.315500, -40.312800, INET '10.10.23.10');
        CALL sp_registrar_marcacao_ponto(23, 23, 4, TIMESTAMP '2026-02-10 17:00:00', -20.315500, -40.312800, INET '10.10.23.10');
        CALL sp_fechar_espelho_ponto_mensal(23, 2026, 2);
        RAISE NOTICE '[ETAPA 5a - PROCEDURE] sp_fechar_espelho_ponto_mensal fechou e assinou Fev/2026 (Colab #23).';
    END IF;

    BEGIN
        CALL sp_registrar_marcacao_ponto(23, 23, 1, TIMESTAMP '2026-02-11 08:00:00', -20.315500, -40.312800, INET '10.10.23.10');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[ETAPA 5b - TRIGGER 3] tg_bloquear_alteracao_espelho_fechado BLOQUEOU: %', SQLERRM;
    END;

    -- ------------------------------------------------------------------------
    -- ETAPA 6: Vínculo de nova escala de trabalho (sp_vincular_escala_trabalho)
    -- ------------------------------------------------------------------------
    INSERT INTO work_schedule (employer_id, name, daily_minutes, tolerance_minutes)
    VALUES (2, 'Escala Fluxo 09-18', 480, 5)
    ON CONFLICT (employer_id, name) DO NOTHING;

    SELECT work_schedule_id INTO v_new_schedule_id
      FROM work_schedule
     WHERE employer_id = 2 AND name = 'Escala Fluxo 09-18';

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

    IF NOT EXISTS (
        SELECT 1 FROM employee_schedule_history
         WHERE employee_id = 2 AND work_schedule_id = v_new_schedule_id
    ) THEN
        CALL sp_vincular_escala_trabalho(v_new_schedule_id, ARRAY[2], DATE '2026-11-01');
        RAISE NOTICE '[ETAPA 6 - PROCEDURE] sp_vincular_escala_trabalho vinculou nova escala ao Colab #2.';
    END IF;

    RAISE NOTICE '================ FLUXO COMPLETO CONCLUÍDO COM SUCESSO ================';
END $$;

-- ----------------------------------------------------------------------------
-- ETAPA 7: Painel Final — Verificação das 5 Views após execução de todo o fluxo
-- ----------------------------------------------------------------------------
SELECT 'vw_espelho_ponto_detalhado'          AS view_name, COUNT(*) AS total_registros FROM vw_espelho_ponto_detalhado
UNION ALL
SELECT 'vw_resumo_banco_horas_colaboradores' AS view_name, COUNT(*) AS total_registros FROM vw_resumo_banco_horas_colaboradores
UNION ALL
SELECT 'vw_relatorio_inconsistencias_ponto'  AS view_name, COUNT(*) AS total_registros FROM vw_relatorio_inconsistencias_ponto
UNION ALL
SELECT 'vw_demonstrativo_adicional_noturno'  AS view_name, COUNT(*) AS total_registros FROM vw_demonstrativo_adicional_noturno
UNION ALL
SELECT 'vw_escalas_jornadas_vigentes'        AS view_name, COUNT(*) AS total_registros FROM vw_escalas_jornadas_vigentes;
