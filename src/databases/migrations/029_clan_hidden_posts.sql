-- =============================================================================
-- Migration 029: Posts ocultos por clan
-- =============================================================================
-- Permite ao dono do clan (subperfil com role='owner' em tb_clan_member) ocultar
-- um post do feed publico do clan SEM apagar o post de origem (que continua no
-- portfolio do subperfil/membro). Ocultacao eh por par (clan, post): o mesmo
-- post pode estar oculto em um clan e visivel em outro, e continua aparecendo
-- normalmente no perfil do membro.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.tb_clan_hidden_post (
  id_clan_profile     UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_portfolio_item   UUID         NOT NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE CASCADE,
  hidden_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  hidden_by_user      UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  reason              TEXT         NULL,
  PRIMARY KEY (id_clan_profile, id_portfolio_item)
);

-- Indice reverso: util para limpar todos os "hide" de um post quando ele for
-- excluido em cascade (ja eh ON DELETE CASCADE, mas o indice acelera lookups
-- por item).
CREATE INDEX IF NOT EXISTS idx_clan_hidden_post_item
  ON public.tb_clan_hidden_post (id_portfolio_item);

COMMIT;
