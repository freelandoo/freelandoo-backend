-- =============================================================================
-- Migration 214: domínio próprio do site da comunidade
-- =============================================================================
-- A comunidade pode apontar um domínio dela (padariadoze.com.br) para o site
-- montado no construtor.
--
-- POR QUE VERIFICAÇÃO É OBRIGATÓRIA, E NÃO UM LUXO:
-- sem provar a posse, qualquer usuário logado cadastraria `bancodobrasil.com.br`
-- no painel. Dois estragos reais saem disso: (1) o pedido de certificado TLS em
-- nome de um domínio alheio, que além de falhar queima cota do emissor e pode
-- nos marcar como abusadores; (2) o dia em que aquele domínio expira ou é
-- redirecionado, a plataforma passa a servir conteúdo sob um nome que não é
-- dela. Por isso `status` só sai de 'pending' depois de um TXT conferido no DNS.
--
-- POR QUE `status` E NÃO UM BOOLEANO `verified`:
-- o ciclo de vida tem quatro estados de verdade, e três deles precisam aparecer
-- na tela com instrução diferente:
--   pending   → falta a pessoa criar o TXT (mostramos o valor a copiar)
--   verified  → posse provada, falta o certificado sair (mostramos "aguarde")
--   active    → no ar
--   error     → algo caiu depois de funcionar (DNS mudou, certificado expirou)
-- Um booleano esconderia a diferença entre "ainda não" e "quebrou", que é
-- exatamente a que o dono precisa para saber se ele tem algo a fazer.
--
-- O domínio é único no SITE INTEIRO, não por comunidade: um nome de domínio
-- resolve para um lugar só, e duas comunidades reivindicando o mesmo é uma
-- disputa que o banco tem que recusar, não a aplicação.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_community_domain (
  id_domain        BIGSERIAL PRIMARY KEY,
  id_profile       UUID NOT NULL
    REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,

  -- Guardado normalizado (minúsculo, sem protocolo, sem porta, sem barra).
  -- 253 é o limite de um nome de domínio completo (RFC 1035).
  domain           VARCHAR(253) NOT NULL,

  status           VARCHAR(16)  NOT NULL DEFAULT 'pending',

  -- Segredo que a pessoa publica no TXT `_freelandoo.<domínio>` para provar
  -- posse. Não é sensível depois de publicado (fica visível no DNS do mundo),
  -- mas é imprevisível para que ninguém adivinhe o valor de um domínio alheio.
  verification_token VARCHAR(64) NOT NULL,
  verified_at        TIMESTAMPTZ NULL,

  -- Estado do lado do provedor de certificado (Vercel/Cloudflare). Fica em
  -- JSONB porque cada provedor devolve um formato próprio e nenhum deles é
  -- consultado por SQL — é diagnóstico para a tela e para o log, não dado
  -- relacional. Trocar de provedor não deve exigir migration.
  provider         VARCHAR(24)  NOT NULL DEFAULT 'manual',
  provider_state   JSONB        NOT NULL DEFAULT '{}'::jsonb,

  last_error       TEXT         NULL,
  last_checked_at  TIMESTAMPTZ  NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_community_domain_status
    CHECK (status IN ('pending', 'verified', 'active', 'error')),
  CONSTRAINT chk_community_domain_format
    CHECK (
      domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      AND length(domain) BETWEEN 4 AND 253
    ),
  CONSTRAINT chk_community_domain_provider_state
    CHECK (jsonb_typeof(provider_state) = 'object')
);

-- Um domínio pertence a UMA comunidade no site inteiro.
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_domain_name
  ON public.tb_community_domain (domain);

-- Listagem no painel do líder.
CREATE INDEX IF NOT EXISTS ix_community_domain_profile
  ON public.tb_community_domain (id_profile, created_at DESC);

-- A resolução por Host acontece a cada visita vinda de domínio próprio; o
-- índice parcial cobre só o que interessa nesse caminho (o que já está no ar).
CREATE INDEX IF NOT EXISTS ix_community_domain_active
  ON public.tb_community_domain (domain)
  WHERE status = 'active';
