-- 438 — MEU MUNDO 3D, lore v2 F5: o Arquivo e os vídeos.
--
-- tb_mm_archive: os textos do Arquivo que cada CONTA destravou e leu. Quem
-- destrava é o servidor (utils/meuMundoArchive.js: fim de capítulo, passo
-- alcançado, monstro vencido); `read_at` é o que o check archive:<id> lê.
-- tb_mm_video: o vídeo (e a imagem de capa) que o admin subiu para cada
-- capítulo e cada personagem. Sem linha = o jogo mostra imagem + texto.
-- Idempotente: só cria.

CREATE TABLE IF NOT EXISTS public.tb_mm_archive (
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  entry_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL,
  PRIMARY KEY (id_user, entry_id),
  CONSTRAINT chk_mm_archive_entry CHECK (entry_id ~ '^[a-z0-9_]{1,40}$')
);

CREATE TABLE IF NOT EXISTS public.tb_mm_video (
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  video_url TEXT NULL,
  poster_url TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  PRIMARY KEY (kind, ref),
  CONSTRAINT chk_mm_video_kind CHECK (kind IN ('chapter', 'character')),
  CONSTRAINT chk_mm_video_ref CHECK (ref ~ '^[a-z0-9_]{1,40}$')
);
