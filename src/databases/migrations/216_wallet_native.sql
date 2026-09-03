-- =============================================================================
-- Migration 216: Carteira sai da Loja de Funções — é NATIVA de todo perfil
-- =============================================================================
-- Decisão do Alex (2026-09-03): a Carteira ganhou botão próprio no headcard e
-- "todos os perfis terão ela nativa". Ninguém compra mais.
--
-- POR QUE `is_for_sale = FALSE` E NÃO APAGAR A LINHA: o catálogo da mig 191 é
-- FECHADO — uma linha por feature_key da whitelist, sem criar/excluir pelo
-- admin. `is_for_sale = FALSE` já é o estado "função GRÁTIS" documentado lá e
-- tem os dois efeitos que se quer, sem código novo:
--   1. `FunctionStoreService.ownershipMap` conta a função como POSSUÍDA por
--      todo mundo (`!product.is_for_sale` → owned), então o gate do front
--      (`useUserFeature` = owned && pref) passa a depender só da preferência
--      pessoal do dono na seção "Funções";
--   2. `listProducts(onlyForSale)` filtra `is_for_sale = TRUE`, então a Carteira
--      some da vitrine /funcoes, e `createCheckout` recusa com "Função não está
--      à venda" — inclusive o pagamento em Poléns (mig 195).
-- Apagar a linha faria o produto sumir do admin e tirar a possibilidade de o
-- Alex reverter num clique; é a mesma escolha que a `vitrine` já usa desde a
-- mig 191, quando a V1 tirou o gate de pagamento dela.
--
-- PREÇOS FICAM COMO ESTÃO de propósito. Em especial `price_polens`: a regra da
-- mig 195 é que NULL significa "nunca configurado" e o seed do boot repõe 1000
-- em quem estiver NULL — zerar aqui para "limpar" faria a Carteira voltar a ter
-- preço em Poléns no próximo deploy. Com `is_for_sale = FALSE` o preço é inerte.
--
-- Na data desta migration não havia NENHUMA compra na tb_user_function_purchase
-- (nem em dinheiro nem em Poléns), então ninguém pagou por algo que agora é
-- grátis e não há reembolso a fazer.
--
-- Idempotente: rodar de novo não acha linha.
-- =============================================================================

UPDATE public.tb_function_product
   SET is_for_sale = FALSE,
       updated_at  = NOW()
 WHERE feature_key = 'wallet'
   AND is_for_sale = TRUE;
