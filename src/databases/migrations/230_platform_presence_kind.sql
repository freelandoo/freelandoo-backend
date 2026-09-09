-- =============================================================================
-- Migration 230: a presença passa a ter PLATAFORMA
-- =============================================================================
-- Pedido do Alex (2026-09-08), olhando a Carteira: "coloca o ranking ali, o
-- mesmo parâmetro do games — likes, comentários, tempo online apenas dentro da
-- plataforma financeira".
--
-- Era a pendência que a mig 229 deixou anotada em voz alta: o Financeiro nasceu
-- com o ranking de games inteiro (curtida 1 · comentário 2 · compartilhamento
-- 3) MENOS o tempo online, porque a batida de presença da mig 226 mede quem
-- está no ambiente de GAMES e somá-la lá daria ponto de presença de games a
-- quem nunca entrou lá. O termo existia na conta e valia zero, esperando uma
-- fonte. Esta migration é a fonte.
--
-- ─── POR QUE UMA COLUNA, E NÃO UMA TABELA NOVA ──────────────────────────────
--
-- A pergunta é a mesma nas duas plataformas: "quantos segundos esta pessoa
-- passou DENTRO deste ambiente neste dia?". O que muda é o ambiente — e isso é
-- uma dimensão da linha, não outro assunto. Uma `tb_finance_presence` gêmea
-- exigiria duas escritas, dois tetos e duas somas para a mesma conta, e a
-- terceira plataforma pediria a terceira tabela.
--
-- ⚠️ O NOME DA TABELA CONTINUA `tb_games_presence`, e ele passa a MENTIR — de
-- propósito. É a mesma decisão que a plataforma já tomou com `tb_machine`
-- (que guarda enxames) e com `tb_story` (que guarda bees): nome físico é
-- LEGADO, o rename é só de aplicação. Renomear a tabela obrigaria a reescrever
-- migration histórica, e a mig 226 já rodou em produção — o runner compara
-- checksum e aborta o boot. Quem lê o código encontra a verdade no
-- PlatformActivityStorage, que já perdeu o nome de games pelo mesmo motivo.
--
-- ─── A CHAVE PRIMÁRIA MUDA, E É ELA QUE SEPARA OS DOIS RELÓGIOS ─────────────
--
-- Era (id_user, day); passa a ser (id_user, kind, day). Sem o `kind` na chave,
-- o UPSERT do Financeiro cairia em cima da linha de games do mesmo dia e as
-- duas plataformas somariam no mesmo balde — a pessoa que passou 3h em games
-- apareceria no ranking financeiro com 3h de presença, exatamente o defeito que
-- a mig 229 se recusou a criar.
--
-- ⚠️ O TETO DIÁRIO PASSA A SER POR PLATAFORMA. As 6h de utils/gamesScore.js são
-- de cada ambiente, não do dia inteiro da pessoa: quem passa a manhã em games e
-- a tarde no Financeiro está presente nos dois, e um teto compartilhado faria a
-- segunda plataforma punir quem usou a primeira.
--
-- ─── AS LINHAS QUE JÁ EXISTEM SÃO DE GAMES ──────────────────────────────────
--
-- O DEFAULT 'games' é o backfill: até hoje a batida só saía do ambiente de
-- games, então toda linha existente é dele. Não há o que decidir aqui, e por
-- isso não há UPDATE de backfill — o default resolve na própria alteração.
-- =============================================================================

ALTER TABLE public.tb_games_presence
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'games';

-- A lista é FECHADA e é a mesma de utils/gamesScore.js (PLATFORM_KINDS).
-- Reescrita como SUPERSET quando entrar uma plataforma nova — a regra das migs
-- 153/207: recriar o CHECK com o nome de sempre, nunca criar um segundo, senão
-- o antigo continua valendo em paralelo e rejeita tudo o que o novo aceita.
ALTER TABLE public.tb_games_presence
  DROP CONSTRAINT IF EXISTS chk_games_presence_kind;
ALTER TABLE public.tb_games_presence
  ADD CONSTRAINT chk_games_presence_kind
  CHECK (kind IN ('games', 'finance'));

-- A PK ganha o `kind`. Idempotente pelo número de colunas: se ela já tem três,
-- esta migration já rodou e não há nada a fazer. O nome é lido do catálogo em
-- vez de chutado — o padrão do Postgres é `<tabela>_pkey`, mas depender disso
-- é depender de uma convenção que ninguém prometeu.
DO $$
DECLARE
  pk_name TEXT;
  pk_cols INT;
BEGIN
  SELECT conname, array_length(conkey, 1)
    INTO pk_name, pk_cols
    FROM pg_constraint
   WHERE conrelid = 'public.tb_games_presence'::regclass
     AND contype = 'p';

  IF pk_name IS NOT NULL AND pk_cols = 2 THEN
    EXECUTE format('ALTER TABLE public.tb_games_presence DROP CONSTRAINT %I', pk_name);
    pk_name := NULL;
  END IF;

  IF pk_name IS NULL THEN
    ALTER TABLE public.tb_games_presence
      ADD CONSTRAINT tb_games_presence_pkey PRIMARY KEY (id_user, kind, day);
  END IF;
END $$;

COMMENT ON TABLE public.tb_games_presence IS
  'Segundos por dia dentro de UM ambiente da plataforma (migs 226/230). O nome e legado: a coluna kind diz de qual ambiente (games | finance). Credito calculado no UPSERT a partir de last_beat_at, com teto por batida e por dia em utils/gamesScore.js.';

COMMENT ON COLUMN public.tb_games_presence.kind IS
  'A plataforma onde a pessoa estava. Lista fechada, espelho de PLATFORM_KINDS em utils/gamesScore.js.';
