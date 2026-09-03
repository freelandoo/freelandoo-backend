-- =============================================================================
-- Migration 215: a foto do PERFIL-CONTA é a foto do USUÁRIO
-- =============================================================================
-- SINTOMA QUE ISTO FECHA: a foto de quem só tem o perfil-conta aparecia na
-- vitrine e sumia na página do perfil. A vitrine (SearchStorage) devolve
-- `tu.avatar` e o tile faz `avatar_url || user_avatar`; a página do perfil
-- (ProfileStorage.getProfileById) devolve só `p.avatar_url`, que no perfil-conta
-- é NULL — o badge de câmera do /account grava em `tb_user.avatar` e nunca
-- tocou a linha do perfil. Duas telas, duas respostas para a mesma pergunta.
--
-- O QUE **NÃO** É A CORREÇÃO: fazer todo perfil sem foto cair na foto do dono.
-- Perfil comprado é um perfil TOTALMENTE INDEPENDENTE — foto, posts e redes são
-- dele, não do titular (régua do Alex). Emprestar a cara do dono a um subperfil
-- é justamente o que não pode acontecer, e é o que a vitrine faz hoje (5 linhas
-- em produção na data desta migration). Quem herda é só o PERFIL-CONTA, porque
-- ele não é "outro perfil": ele É o usuário.
--
-- A FONTE ÚNICA É `tb_user.avatar`. É ela que o /account, o feed, os bees e o
-- menu de espaços já leem, e `UserStorage.updateAvatarById` é o ÚNICO ponto de
-- escrita dela no código inteiro (nem os INSERTs de cadastro/Google preenchem
-- avatar). `tb_profile.avatar_url` do perfil-conta vira ESPELHO mantido por
-- esse mesmo ponto — denormalização deliberada, no espírito dos rótulos
-- congelados da mig 210: sem ela, as ~43 storages que já projetam
-- `pro.avatar_url` (feed, comentários, comunidades, ranking, vitrine…)
-- precisariam cada uma aprender a regra do perfil-conta, e a que esquecesse
-- ficaria calada — exatamente o bug que estamos fechando.
--
-- Backfill nos DOIS sentidos, porque as duas colunas divergiram na prática:
--   (1) perfil-conta com foto própria e usuário sem foto (quem subiu pelo
--       headcard público, que chama POST /profile/:id/avatar) — o valor sobe
--       para tb_user, senão a fonte única nasceria vazia e a pessoa perderia
--       a foto que já tem;
--   (2) usuário com foto e espelho desatualizado (o caso comum: todo mundo que
--       usou o badge de câmera do /account).
--
-- Idempotente: rodar de novo não acha linha nenhuma. (O runner já envolve cada
-- migration em transação própria.)
-- =============================================================================

-- (1) perfil-conta → usuário: só quando o usuário ainda não tem foto.
--     Nunca sobrescreve `tb_user.avatar`, que é a fonte única.
UPDATE public.tb_user u
   SET avatar = p.avatar_url
  FROM public.tb_profile p
 WHERE p.id_user = u.id_user
   AND COALESCE(p.is_user_account, FALSE) = TRUE
   AND p.deleted_at IS NULL
   AND p.avatar_url IS NOT NULL
   AND u.avatar IS NULL;

-- (2) usuário → espelho no perfil-conta.
UPDATE public.tb_profile p
   SET avatar_url = u.avatar
  FROM public.tb_user u
 WHERE u.id_user = p.id_user
   AND COALESCE(p.is_user_account, FALSE) = TRUE
   AND p.deleted_at IS NULL
   AND p.avatar_url IS DISTINCT FROM u.avatar;
