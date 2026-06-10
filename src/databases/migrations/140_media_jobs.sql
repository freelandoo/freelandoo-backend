-- 140 — F4.S1: fila de processamento de mídia (ffmpeg/sharp fora do processo da API).
-- Cada job é um transform (vídeo/imagem/áudio) executado pelo worker forkado
-- (src/workers/media-worker.js). O processo da API insere a linha, o worker
-- processa e a API atualiza o status. Jobs 'queued'/'processing' órfãos de um
-- restart são marcados como error no boot (ninguém mais espera por eles).

CREATE TABLE IF NOT EXISTS media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_status_check;
ALTER TABLE media_jobs
  ADD CONSTRAINT media_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'done', 'error'));

CREATE INDEX IF NOT EXISTS idx_media_jobs_status_created
  ON media_jobs (status, created_at);
