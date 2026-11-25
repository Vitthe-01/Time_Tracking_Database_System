-- ============================================================================
-- DEMO 02: Functions Auxiliares + Registro de Ponto + Triggers de Segurança
-- Demonstra:
--   • fn_distance_meters, fn_night_minutes e fn_refresh_daily_summary
--   • sp_registrar_marcacao_ponto
--   • tg_validar_intervalo_minimo_marcacoes (< 5 min)
--   • tg_alertar_divergencia_geolocalizacao + alerta de rede CIDR (punch_audit)
--   • tg_bloquear_alteracao_espelho_fechado
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '[FUNCTION] fn_distance_meters(SP -> RJ) = % m', fn_distance_meters(-23.55052, -46.633308, -22.90680, -43.172900);
    RAISE NOTICE '[FUNCTION] fn_night_minutes(22h -> 05h) = % min', fn_night_minutes(TIMESTAMP '2026-10-19 22:00:00', TIMESTAMP '2026-10-20 05:00:00');

    -- 1. Marcação válida (Colaborador #21 tem espelho aberto)
    IF NOT EXISTS (SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 08:05:00') THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 1, TIMESTAMP '2026-10-28 08:05:00', -22.906800, -43.172900, INET '10.10.21.15');
        RAISE NOTICE '[OK] Ponto válido registrado (Colab #21 às 08:05).';
    END IF;

    -- 2. Trigger: intervalo mínimo < 5 minutos
    BEGIN
        CALL sp_registrar_marcacao_ponto(21, 21, 2, TIMESTAMP '2026-10-28 08:07:00', -22.906800, -43.172900, INET '10.10.21.15');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[TRIGGER 1 - BLOQUEIO] tg_validar_intervalo_minimo_marcacoes: %', SQLERRM;
    END;

    -- 3. Trigger: fora do raio (SP para local RJ) + IP externo -> grava alertas em punch_audit
    IF NOT EXISTS (SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 17:05:00') THEN
        CALL sp_registrar_marcacao_ponto(21, 21, 4, TIMESTAMP '2026-10-28 17:05:00', -23.550520, -46.633308, INET '189.45.20.99');
        RAISE NOTICE '[TRIGGER 2 - ALERTA] Geolocalização + rede CIDR gravados em punch_audit.';
    END IF;

    -- 4. Trigger: bloqueio em espelho fechado e assinado (Colaborador #1)
    BEGIN
        CALL sp_registrar_marcacao_ponto(1, 1, 1, TIMESTAMP '2026-10-28 08:05:00', -23.550520, -46.633308, INET '10.10.1.15');
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[TRIGGER 3 - BLOQUEIO] tg_bloquear_alteracao_espelho_fechado: %', SQLERRM;
    END;
END $$;

-- Alertas gerados automaticamente em punch_audit
SELECT a.punch_audit_id, e.name AS employee_name, a.alert_type, a.description, p.punched_at, p.ip_address
  FROM punch_audit a
  JOIN time_punch p ON p.time_punch_id = a.time_punch_id
  JOIN employee e ON e.employee_id = a.employee_id
 WHERE a.employee_id = 21
 ORDER BY a.punch_audit_id DESC
 LIMIT 6;
