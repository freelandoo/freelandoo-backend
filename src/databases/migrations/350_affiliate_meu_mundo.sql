-- =============================================================================
-- Migration 350 — A8: afiliado de 10% pelo Meu Mundo 3D
-- =============================================================================
-- Tipo de compra novo no programa de afiliados (mig 192): `meu_mundo_purchase`.
--
--   • Conta o DINHEIRO REAL que o convidado gasta no Meu Mundo: o Gold comprado
--     de dentro do jogo (polen_purchase com return_to = meu-mundo) e, quando o B4
--     existir, personagem/item pago em R$ (metadata `meu_mundo = '1'`).
--   • Esmeralda ganha não conta (não é dinheiro, nunca passa pelo checkout).
--   • Regime plataforma: cria o vínculo vitalício na 1ª compra pelo cupom (como
--     os outros contextos de plataforma), SEM desconto para o comprador.
--   • A % vem DESTA linha (percent_source = 'rule'); o admin muda em
--     /administracao sem código. Prazo, carência, holdback e saque seguem a
--     regra global do programa.
--
-- Idempotente: não sobrescreve a linha se o admin já mexeu nela.
-- =============================================================================

INSERT INTO public.tb_affiliate_commission_rule
  (source_context, regime, is_enabled, percent, percent_source, creates_bond, grants_discount, notes)
VALUES
  ('meu_mundo_purchase', 'platform', TRUE, 10, 'rule', TRUE, FALSE,
   'A8: dinheiro real gasto no Meu Mundo (Gold comprado no jogo; itens em R$ do B4). Esmeralda não conta.')
ON CONFLICT (source_context) DO NOTHING;
