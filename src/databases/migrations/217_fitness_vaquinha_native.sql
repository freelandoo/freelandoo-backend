-- =============================================================================
-- Migration 217: Academia (Fitness) e Vaquinha saem da Loja de Funções
-- =============================================================================
-- Decisão do Alex (2026-09-03): o headcard ganhou os pills de Fitness (laranja)
-- e Games (roxo) ao lado da Carteira, e a Carteira ganhou o cofrinho "Minha
-- vaquinha". Esses botões são NATIVOS do headcard — ninguém compra para tê-los,
-- exatamente como a mig 216 já fez com a Carteira.
--
-- O QUE ESTAVA ACONTECENDO (o motivo desta migration existir): o pill laranja
-- não aparecia para ninguém. `useUserFeature` = posse && preferência, e
-- `fitness_academias` continuava `is_for_sale = TRUE` com zero compras pagas,
-- então `ownershipMap` devolvia owned=false para todo mundo. A Vaquinha estava
-- no mesmo estado e o cofrinho novo da Carteira teria nascido invisível pela
-- mesma razão. Não era gate de código: era o catálogo.
--
-- POR QUE `is_for_sale = FALSE` E NÃO APAGAR A LINHA: o catálogo da mig 191 é
-- FECHADO — uma linha por feature_key da whitelist, sem criar/excluir pelo
-- admin. `is_for_sale = FALSE` já é o estado "função GRÁTIS" documentado lá e
-- tem os dois efeitos que se quer, sem código novo:
--   1. `FunctionStoreService.ownershipMap` conta a função como POSSUÍDA por
--      todo mundo (`!product.is_for_sale` → owned), então o gate do front
--      passa a depender só da preferência pessoal do dono na seção "Funções";
--   2. `listProducts(onlyForSale)` filtra `is_for_sale = TRUE`, então as duas
--      somem da vitrine /funcoes, e `createCheckout` recusa com "Função não
--      está à venda" — inclusive o pagamento em Poléns (mig 195).
-- Apagar a linha faria o produto sumir do admin e tirar a possibilidade de
-- reverter num clique. Mesma escolha da `vitrine` (mig 191) e da mig 216.
--
-- PREÇOS FICAM COMO ESTÃO de propósito. Em especial `price_polens`: a regra da
-- mig 195 é que NULL significa "nunca configurado" e o seed do boot repõe 1000
-- em quem estiver NULL — zerar aqui para "limpar" faria as duas voltarem a ter
-- preço em Poléns no próximo deploy. Com `is_for_sale = FALSE` o preço é inerte.
--
-- SEM REEMBOLSO A FAZER: na data desta migration a tb_user_function_purchase
-- não tinha NENHUMA compra `paid` de 'fitness_academias' nem de 'vaquinha' (a
-- única compra paga do sistema inteiro é de 'communities', em Poléns). Existe
-- uma linha `pending` de 'fitness_academias' de 36 dias atrás — checkout
-- abandonado, cuja sessão do Stripe expirou em 24h. Ela fica onde está: é
-- histórico morto e, com a função agora grátis, é inerte de qualquer forma.
--
-- Idempotente: rodar de novo não acha linha com is_for_sale = TRUE.
-- =============================================================================

UPDATE public.tb_function_product
   SET is_for_sale = FALSE,
       updated_at  = NOW()
 WHERE feature_key IN ('fitness_academias', 'vaquinha')
   AND is_for_sale = TRUE;
