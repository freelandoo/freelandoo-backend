-- =============================================================================
-- Migration 278: VÍNCULO DO APP (EVO Brazil nativo) — código de uso único +
--                sessão de app revogável
-- =============================================================================
-- Pedido do Alex (2026-10-13, Fase 3): o jogo EVO Brazil vira app Android
-- separado. A pessoa já está logada na Freelandoo no navegador do celular; o
-- site mostra um CÓDIGO curto e o app troca esse código por uma sessão.
--
-- Duas tabelas, e a separação é o desenho inteiro:
--
--   tb_app_link_code  o código curto (5 min, uso único). Só o HASH é guardado:
--                     o código cru é uma credencial que vale uma conta inteira
--                     durante cinco minutos.
--   tb_app_session    a sessão que o app recebe. É REVOGÁVEL (lista em
--                     /me/app-sessions) — um JWT longo não seria, e o aparelho
--                     pode ser perdido. O app guarda um refresh token opaco
--                     (também só o hash aqui) e troca por um JWT normal de 1
--                     dia. Assim o authMiddleware continua sendo JWT puro, sem
--                     I/O, e a Monsters API não muda nada (ela valida o mesmo
--                     JWT perguntando GET /users/me).
--
-- ⚠️ Revogar vale na PRÓXIMA renovação: o JWT já emitido vive até expirar
--    (≤ 1 dia). É o mesmo limite do logout do site hoje.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_app_link_code (
  id_link_code  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  code_hash     CHAR(64) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  CONSTRAINT chk_app_link_code_hash CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

-- O mesmo código nunca vale duas vezes: o hash é único na tabela inteira (um
-- código já usado não pode ser reemitido, nem por acaso do sorteio).
CREATE UNIQUE INDEX IF NOT EXISTS ux_app_link_code_hash
  ON public.tb_app_link_code (code_hash);

CREATE INDEX IF NOT EXISTS ix_app_link_code_user_live
  ON public.tb_app_link_code (id_user)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tb_app_session (
  id_app_session UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user        UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  token_hash     CHAR(64) NOT NULL,
  app            VARCHAR(32) NOT NULL DEFAULT 'evo_brazil',
  device_label   VARCHAR(80),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  CONSTRAINT chk_app_session_hash CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_session_token
  ON public.tb_app_session (token_hash);

CREATE INDEX IF NOT EXISTS ix_app_session_user_live
  ON public.tb_app_session (id_user)
  WHERE revoked_at IS NULL;
