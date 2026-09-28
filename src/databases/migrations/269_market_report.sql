-- 269_market_report.sql
--
-- RELATÓRIO DE MERCADO LOCAL (2026-09-28): "quanto os barbeiros estão cobrando
-- na minha região". Sem tabela nova, de propósito — os preços já estão
-- cadastrados com lugar (serviço e produto no perfil, anúncio na comunidade), e
-- uma tabela de "preços de mercado" seria a segunda verdade sobre o mesmo
-- número. Ver `src/utils/marketReport.js`.
--
-- Aqui entra só o kill-switch. Nasce ligado.
INSERT INTO public.tb_feature_flag (flag_key, is_enabled, label, description)
VALUES (
  'mercado_local', TRUE, 'Relatório de mercado local',
  'Quanto se cobra por serviço e produto por comunidade, cidade, região e estado, a partir dos preços cadastrados na plataforma.'
)
ON CONFLICT (flag_key) DO NOTHING;
