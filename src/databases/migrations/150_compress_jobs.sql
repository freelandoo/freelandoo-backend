-- =============================================================================
-- Migration 150: Uso da ferramenta /comprimir (limite por hora, por conta)
-- =============================================================================
-- O ffmpeg da compressão de vídeo roda no Railway (CPU = custo). Pra conter
-- abuso, cada compressão de vídeo grava uma linha aqui e o serviço conta as
-- linhas da última hora antes de processar:
--   - conta gratuita (sem subperfil pago)  →  2 vídeos/hora
--   - conta com subperfil pago (assinatura) → 10 vídeos/hora
--
-- Tabela enxuta de telemetria/contagem — sem FK rígida pra não acoplar ao ciclo
-- de vida do usuário (uma limpeza de conta não precisa cascatear aqui). O índice
-- (id_user, created_at) cobre o COUNT(...) WHERE created_at > NOW()-1h.

CREATE TABLE IF NOT EXISTS public.compress_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user     UUID NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'video',
  size_bytes  BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_compress_jobs_user_time
  ON public.compress_jobs (id_user, created_at DESC);

-- Retenção: índice por created_at pra a varredura periódica que apaga linhas
-- antigas (a janela de interesse é só 1h; nada precisa viver mais que ~1 dia).
CREATE INDEX IF NOT EXISTS ix_compress_jobs_created
  ON public.compress_jobs (created_at);
