-- 221_community_professionals.sql
-- A EQUIPE que atende pelo site da comunidade.
--
-- ═══ O PROBLEMA QUE ISTO RESOLVE ═══
--
-- A vitrine do site mostra os serviços do LÍDER (2026-09-04) e a agenda é da
-- CONTA dele (mig 190). Isso serve o prestador sozinho, mas não a barbearia com
-- três barbeiros: quem agenda precisa escolher COM QUEM, e cada um tem a própria
-- agenda e os próprios serviços.
--
-- ═══ POR QUE UMA TABELA, E NÃO UM CAMPO NO JSONB DO SITE ═══
--
-- Uma lista de @username dentro do documento do site seria uma cópia de quem é
-- quem: a pessoa sai da comunidade, muda de nome, apaga a conta — e o site
-- continuaria anunciando que ela atende. Aqui a linha é uma FK viva: some com o
-- usuário (CASCADE) e com a comunidade (CASCADE).
--
-- ═══ O QUE ESTA LINHA NÃO DÁ ═══
--
-- ⚠️ Ser profissional NÃO é um papel dentro da comunidade. Não dá poder de
-- moderação, não edita o site, não vê o que membro não vê. É só isto: "esta
-- pessoa aparece no site como quem atende, e a agenda dela é agendável por lá".
-- Papel de comunidade continua sendo `tb_community_member.role` — misturar as
-- duas coisas transformaria uma escolha de vitrine numa promoção silenciosa.
--
-- Espelha `tb_academy_professor` (mig 176) de propósito: é a mesma pergunta
-- ("quem trabalha aqui?") e a mesma forma de responder — o dono promove alguém
-- que JÁ está vinculado. O líder não entra aqui: ele é profissional por
-- construção, e uma linha para ele seria uma segunda verdade sobre um fato que
-- `tb_profile.id_leader_user` já guarda.

CREATE TABLE IF NOT EXISTS public.tb_community_professional (
  -- A comunidade. Comunidade mora em tb_profile (is_community = TRUE) — quem
  -- garante que é mesmo uma é o service, porque um CHECK aqui precisaria de
  -- subconsulta.
  id_profile  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user     UUID         NOT NULL REFERENCES public.tb_user(id_user)       ON DELETE CASCADE,
  -- Quem promoveu. SET NULL: a conta do líder antigo pode sumir sem levar a
  -- equipe junto.
  granted_by  UUID         NULL     REFERENCES public.tb_user(id_user)       ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_profile, id_user)
);

-- "De quais comunidades esta pessoa é profissional?" — a pergunta que a saída
-- dela (ou a exclusão da conta) faz.
CREATE INDEX IF NOT EXISTS ix_community_professional_user
  ON public.tb_community_professional (id_user);
