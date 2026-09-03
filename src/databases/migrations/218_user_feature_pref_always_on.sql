-- =============================================================================
-- Migration 218: função de usuário é SEMPRE ligada — acaba o desligar pessoal
-- =============================================================================
-- Decisão do Alex (2026-09-03): "permaneça todas as funções de todo mundo
-- sempre true, exclua a possibilidade de deixar false".
--
-- POR QUE: a preferência pessoal (mig 186, seção "Funções" do menu lateral)
-- era o segundo gate de `useUserFeature` (= posse && preferência) e escondia
-- pontos de entrada SEM erro nenhum — foi ela que, junto do gate da Loja de
-- Funções, sumiu com o pill de Fitness do headcard. Quem possui a função passa
-- a ver a função, ponto. O que decide o acesso continua sendo a POSSE (Loja de
-- Funções, mig 191) e a flag global do admin (tb_feature_flag), que seguem
-- inteiras: esta migration não dá função a ninguém.
--
-- ESTA MIGRATION SÓ LIGA O QUE ESTAVA DESLIGADO. Na data em que foi escrita a
-- tabela tinha 10 linhas de UM único usuário (o próprio Alex), 4 delas
-- desligadas: fitness_academias, profiles, vaquinha e vitrine. Nenhum outro
-- usuário jamais tocou numa preferência, então nada é decidido no lugar de
-- terceiros.
--
-- ⚠️ `vitrine` é a ÚNICA com efeito SERVER-SIDE: desligada, ela tirava os
-- perfis do dono da vitrine pública (SearchStorage). Ligá-la devolve os perfis
-- do Alex à busca pública — é o efeito pedido, e a cláusula que a lia foi
-- removida do SearchStorage no mesmo commit, senão sobraria uma porta que só
-- SQL cru conseguiria fechar.
--
-- A TABELA NÃO É APAGADA de propósito: o `PUT /users/me/features/:key` passa a
-- responder 410 e nada mais escreve `FALSE`, então as linhas viram histórico
-- inerte. Manter a tabela é o que permite reintroduzir a preferência um dia
-- sem migration de volta.
--
-- Idempotente: rodar de novo não acha linha com is_enabled = FALSE.
-- =============================================================================

UPDATE public.tb_user_feature_pref
   SET is_enabled = TRUE,
       updated_at = NOW()
 WHERE is_enabled = FALSE;
