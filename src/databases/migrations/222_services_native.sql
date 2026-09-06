-- =============================================================================
-- Migration 222: Serviços sai da Loja de Funções (função nativa)
-- =============================================================================
-- Decisão do Alex (2026-09-06): a aba "Serviços" foi para depois de "Salvos" na
-- barra da vitrine do /account, e ele quer a função NATIVA para todo mundo —
-- ninguém compra para ter os próprios serviços no perfil.
--
-- O QUE ESTAVA ACONTECENDO (o motivo desta migration existir): a aba não
-- aparecia para ninguém. `useUserFeature` lê POSSE (a preferência pessoal morreu
-- na mig 218), e `services` continuava `is_for_sale = TRUE` com ZERO compras
-- pagas — então `ownershipMap` devolvia owned=false para todo mundo e a entrada
-- nascia invisível. Mesma armadilha do pill de Fitness na mig 217: não era gate
-- de código, era o catálogo. A flag global `services` do admin já está LIGADA,
-- então o catálogo era o único bloqueio.
--
-- POR QUE `is_for_sale = FALSE` E NÃO APAGAR A LINHA: o catálogo da mig 191 é
-- FECHADO — uma linha por feature_key da whitelist, sem criar/excluir pelo
-- admin. `is_for_sale = FALSE` já é o estado "função GRÁTIS" documentado lá e
-- tem os dois efeitos que se quer, sem código novo:
--   1. `FunctionStoreService.ownershipMap` conta a função como POSSUÍDA por
--      todo mundo (`!product.is_for_sale` → owned), então a aba Serviços volta
--      no /account e na página do próprio perfil, para a base inteira;
--   2. `listProducts(onlyForSale)` filtra `is_for_sale = TRUE`, então Serviços
--      some da vitrine /funcoes e `createCheckout` recusa com "Função não está
--      à venda" — inclusive o pagamento em Poléns (mig 195).
-- Apagar a linha faria o produto sumir do admin e tirar a possibilidade de
-- reverter num clique. Mesma escolha da `vitrine` (mig 191), da 216 e da 217.
--
-- PREÇO FICA COMO ESTÁ de propósito. `price_cents` segue 990 e inerte. E não se
-- mexe em `price_polens`: pela regra da mig 195, NULL significa "nunca
-- configurado" — `services` está NULL porque nunca entrou na venda por Poléns
-- (o seed do boot só semeia fitness_academias/wallet/communities/vaquinha).
-- Escrever qualquer coisa aqui seria configurar um preço para uma função que
-- deixou de estar à venda.
--
-- SEM REEMBOLSO A FAZER: conferido em produção nesta data, a
-- tb_user_function_purchase não tem NENHUMA compra `paid` de 'services'. Existe
-- uma linha `pending` de 2026-08-06 — checkout abandonado, cuja sessão do
-- Stripe expirou em 24h. Ela fica onde está: é histórico morto e, com a função
-- agora grátis, é inerte de qualquer forma.
--
-- AS OUTRAS À VENDA CONTINUAM À VENDA: 'courses', 'store', 'profiles',
-- 'communities' e 'agenda' seguem `is_for_sale = TRUE`. Só Serviços foi pedido.
--
-- Idempotente: rodar de novo não acha linha com is_for_sale = TRUE.
-- =============================================================================

UPDATE public.tb_function_product
   SET is_for_sale = FALSE,
       updated_at  = NOW()
 WHERE feature_key = 'services'
   AND is_for_sale = TRUE;
