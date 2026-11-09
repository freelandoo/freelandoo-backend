-- 435 — MEU MUNDO: nível de aventura POR PERSONAGEM (regra do Alex, 2026-11-09).
--
-- "Quando a gente muda de personagem, o personagem carrega o nível; tem que começar do
-- zero." Até aqui o XP de aventura era da PESSOA (tb_mm_adventure, mig 320) e passava de
-- um personagem para o outro. Agora cada personagem tem o seu: personagem novo (embrião,
-- fusão, prêmio, hóspede novo) nasce no nível 1 com 0 de XP; trocar pela cápsula leva o
-- nível de cada um junto.
--
-- tb_mm_adventure fica como histórico (não é mais lida). O XP que existia vai para o
-- personagem ORIGINAL de cada pessoa: o hóspede mais antigo que ainda existe (vivo ou na
-- cápsula); sem hóspede, o personagem mais antigo que ainda existe.
--
-- Idempotente (IF NOT EXISTS / ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS public.tb_mm_char_adventure (
  id_character UUID PRIMARY KEY REFERENCES public.tb_mm_character(id_character) ON DELETE CASCADE,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  xp BIGINT NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  losses_day DATE NULL,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_mm_char_adventure_xp CHECK (xp >= 0),
  CONSTRAINT chk_mm_char_adventure_level CHECK (level >= 1)
);

CREATE INDEX IF NOT EXISTS ix_mm_char_adventure_user ON public.tb_mm_char_adventure (id_user);
CREATE INDEX IF NOT EXISTS ix_mm_char_adventure_rank ON public.tb_mm_char_adventure (level DESC, xp DESC);

INSERT INTO public.tb_mm_char_adventure (id_character, id_user, xp, level, losses_day, losses, updated_at)
SELECT orig.id_character, a.id_user, a.xp, a.level, a.losses_day, a.losses, a.updated_at
  FROM public.tb_mm_adventure a
  JOIN LATERAL (
    SELECT ch.id_character
      FROM public.tb_mm_character ch
     WHERE ch.id_user = a.id_user
       AND ch.status IN ('alive', 'capsule')
     ORDER BY (ch.origin = 'hospede') DESC, ch.created_at ASC, ch.id_character
     LIMIT 1
  ) orig ON TRUE
ON CONFLICT (id_character) DO NOTHING;
