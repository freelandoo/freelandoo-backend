-- 375 — MEU MUNDO 3D B8 (2026-11-08): LÂMINAS = HALL. Cadeiras do Hall e desafios pela vaga.
--
-- Decisão (docs/prompts/FILA.md, B8, pela recomendação): o Hall das Lâminas tem 10 CADEIRAS
-- (1 = o topo). Qualquer jogador escolhe alguém sentado no Hall, ou do top 100 do Poder (B7),
-- e desafia. A luta é re-simulada no servidor (mm3d-59) contra a FICHA CONGELADA do defensor:
-- o Poder dos dois no instante do desafio vira a razão `peer` da regra da luta (o adversário
-- com os status de quem desafia × peer, de 0,5 a 2), gravada aqui — o defensor não precisa
-- estar online. Venceu quem estava sentado: troca de cadeira (o defensor desce para a do
-- desafiante, ou sai do Hall se ele não tinha). Venceu alguém de fora do Hall: senta na
-- primeira cadeira vazia, se houver. Limites: 3 desafios por dia (Brasília) e o mesmo
-- defensor só uma vez a cada 24 h. O defensor recebe aviso no sino.
--
-- tb_mm_hall_member (mig 312, os títulos de 3 meses em 1º) segue igual: é outra coisa.
-- Idempotente.

-- a luta do desafio tem origem própria: CHECK reescrito como SUPERSET com o mesmo nome
ALTER TABLE public.tb_mm_fight DROP CONSTRAINT IF EXISTS chk_mm_fight_origin;
ALTER TABLE public.tb_mm_fight
  ADD CONSTRAINT chk_mm_fight_origin CHECK (origin IN ('laminas', 'boxe', 'mob', 'tutorial', 'hall'));

CREATE TABLE IF NOT EXISTS public.tb_mm_hall_seat (
  seat INTEGER PRIMARY KEY,
  id_user UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  defenses INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_mm_hall_seat CHECK (seat BETWEEN 1 AND 10),
  CONSTRAINT chk_mm_hall_seat_def CHECK (defenses >= 0)
);

CREATE TABLE IF NOT EXISTS public.tb_mm_hall_challenge (
  id_challenge UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_fight UUID NOT NULL UNIQUE REFERENCES public.tb_mm_fight(id_fight) ON DELETE CASCADE,
  challenger UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  defender UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- cadeiras no instante do desafio (NULL = fora do Hall)
  challenger_seat INTEGER NULL,
  defender_seat INTEGER NULL,
  -- a ficha congelada: o Poder dos dois e a razão usada na luta
  challenger_power INTEGER NOT NULL,
  defender_power INTEGER NOT NULL,
  peer NUMERIC(6, 4) NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  -- a cadeira com que o desafiante ficou (vitória que mudou o Hall)
  seat_won INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_mm_hall_challenge_status CHECK (status IN ('open', 'won', 'lost')),
  CONSTRAINT chk_mm_hall_challenge_self CHECK (challenger <> defender)
);
CREATE INDEX IF NOT EXISTS ix_mm_hall_challenge_by ON public.tb_mm_hall_challenge (challenger, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_mm_hall_challenge_def ON public.tb_mm_hall_challenge (defender, created_at DESC);
