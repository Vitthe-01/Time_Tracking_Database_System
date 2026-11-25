-- ============================================================================
-- TESTE 03: sp_registrar_marcacao_ponto + Triggers de Validação e Auditoria
-- Testa:
--   1. Marcação válida (dentro do raio e da rede CIDR)
--   2. Trigger tg_validar_intervalo_minimo_marcacoes (< 5 minutos)
--   3. Trigger tg_alertar_divergencia_geolocalizacao + alerta de rede (CIDR)
--   4. Trigger tg_bloquear_alteracao_espelho_fechado (espelho fechado e assinado)
--   5. Validação de dispositivo pertencente a outro empregador
-- ============================================================================

DO $$
BEGIN
    -- CASO 1: Marcação válida para Colaborador #21 (espelho de Out/2026 está aberto)
    IF NOT EXISTS (
        SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 08:05:00'
    ) THEN
        CALL sp_registrar_marcacao_ponto(
            21, 21, 1,
            TIMESTAMP '2026-10-28 08:05:00',
            -22.906800, -43.172900,
            INET '10.10.21.15'
        );
        RAISE NOTICE '[OK] Caso 1: Marcação válida registrada para Colaborador #21.';
    ELSE
        RAISE NOTICE '[INFO] Caso 1: Marcação das 08:05 já havia sido registrada anteriormente.';
    END IF;

    -- CASO 2: Intervalo menor que 5 minutos (deve ser bloqueado pelo trigger)
    BEGIN
        CALL sp_registrar_marcacao_ponto(
            21, 21, 2,
            TIMESTAMP '2026-10-28 08:07:00',
            -22.906800, -43.172900,
            INET '10.10.21.15'
        );
        RAISE WARNING '[FALHA] Caso 2: Deveria ter bloqueado intervalo < 5 min!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 2 bloqueado pelo trigger tg_validar_intervalo_minimo_marcacoes: %', SQLERRM;
    END;

    -- CASO 3: Fora do raio (coords de SP para local no RJ) + IP externo (gera 2 alertas em punch_audit)
    IF NOT EXISTS (
        SELECT 1 FROM time_punch WHERE employee_id = 21 AND punched_at = TIMESTAMP '2026-10-28 17:05:00'
    ) THEN
        CALL sp_registrar_marcacao_ponto(
            21, 21, 4,
            TIMESTAMP '2026-10-28 17:05:00',
            -23.550520, -46.633308,
            INET '189.45.20.99'
        );
        RAISE NOTICE '[OK] Caso 3: Marcação fora do raio/rede registrada (alertas gravados em punch_audit).';
    ELSE
        RAISE NOTICE '[INFO] Caso 3: Marcação das 17:05 já havia sido registrada anteriormente.';
    END IF;

    -- CASO 4: Espelho fechado e assinado (Colaborador #1 em Out/2026)
    BEGIN
        CALL sp_registrar_marcacao_ponto(
            1, 1, 1,
            TIMESTAMP '2026-10-28 08:05:00',
            -23.550520, -46.633308,
            INET '10.10.1.15'
        );
        RAISE WARNING '[FALHA] Caso 4: Deveria ter bloqueado alteração em espelho fechado!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 4 bloqueado pelo trigger tg_bloquear_alteracao_espelho_fechado: %', SQLERRM;
    END;

    -- CASO 5: Dispositivo de outro empregador (Colaborador #21 usando device #1)
    BEGIN
        CALL sp_registrar_marcacao_ponto(
            21, 1, 1,
            TIMESTAMP '2026-10-29 08:00:00',
            -22.906800, -43.172900,
            INET '10.10.21.15'
        );
        RAISE WARNING '[FALHA] Caso 5: Deveria ter rejeitado dispositivo de outro empregador!';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[OK] Caso 5 bloqueado pela procedure: %', SQLERRM;
    END;
END $$;

-- Verificação dos alertas gerados automaticamente em punch_audit para o Colaborador #21
SELECT a.punch_audit_id, a.time_punch_id, a.employee_id, a.alert_type, a.description, p.punched_at, p.ip_address
  FROM punch_audit a
  JOIN time_punch p ON p.time_punch_id = a.time_punch_id
 WHERE a.employee_id = 21
 ORDER BY a.punch_audit_id DESC
 LIMIT 10;
