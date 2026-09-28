-- 267_delivery_platform_fee.sql
--
-- O DELIVERY ENTRE VIZINHOS PASSA A DEIXAR 3% PARA A FREELANDOO.
--
-- Decisão do Alex (2026-09-28): "o morador de bairro e condomínio paga 3,50
-- para a Freelandoo, não para o líder. O delivery também, fica 3% para a
-- Freelandoo."
--
-- A mensalidade de R$3,50 da vitrine (mig 252) JÁ era inteira da plataforma —
-- nenhuma linha de código credita o líder com ela. O que muda aqui é o
-- delivery: até agora a corrida rendia ao entregador tudo menos a tarifa do
-- gateway, e a plataforma não ficava com nada.
--
-- ─── QUEM ABSORVE ──────────────────────────────────────────────────────────
-- Quem ENTREGA, como já absorve a tarifa do gateway (decisão da mig 248). Quem
-- pede continua pagando o preço publicado — a faixa de peso não muda de valor.
-- A tela de quem entrega mostra o LÍQUIDO antes do aceite, então os 3% chegam
-- ao vizinho como número, nunca como surpresa na carteira.
--
-- ─── ONDE MORA A RÉGUA ─────────────────────────────────────────────────────
-- Na MESMA linha da venda na vitrine (`tb_community_listing_settings`), que já
-- é a régua admin-editável do comércio entre vizinhos. Uma segunda tabela de
-- configuração para a mesma tela de admin seria o segundo lugar que alguém
-- esquece de atualizar.
--
-- ⚠️ CHAMADOS ANTIGOS FICAM EM ZERO, de propósito: a coluna nasce com default
-- 0 e nada é recalculado. Quem aceitou uma corrida viu um líquido na tela, e
-- mudar o número depois do aceite seria cobrar do vizinho uma taxa que ele não
-- aceitou.

ALTER TABLE public.tb_community_listing_settings
  ADD COLUMN IF NOT EXISTS delivery_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 3
    CHECK (delivery_fee_percent >= 0 AND delivery_fee_percent <= 100);

-- O chamado guarda a taxa que valeu NO ACEITE — a régua pode mudar depois.
ALTER TABLE public.tb_community_delivery_request
  ADD COLUMN IF NOT EXISTS platform_fee_cents INT NOT NULL DEFAULT 0
    CHECK (platform_fee_cents >= 0);

-- O repasse carrega a mesma parcela, para o extrato fechar:
--   charge = platform + processor + net
ALTER TABLE public.tb_community_delivery_payout
  ADD COLUMN IF NOT EXISTS platform_fee_cents INT NOT NULL DEFAULT 0
    CHECK (platform_fee_cents >= 0);

-- A entrega comprada junto com um produto da vitrine (mig 249): a taxa da
-- entrega é SEPARADA da taxa sobre o preço, porque a do preço é do vendedor e
-- esta é do entregador.
ALTER TABLE public.tb_community_listing_order
  ADD COLUMN IF NOT EXISTS delivery_platform_fee_cents INT NOT NULL DEFAULT 0
    CHECK (delivery_platform_fee_cents >= 0);
