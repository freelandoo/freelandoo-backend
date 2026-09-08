-- =============================================================================
-- Migration 226: tempo online DENTRO da plataforma de games
-- =============================================================================
-- Pedido do Alex (2026-09-07): "o ranking ali, você utiliza as métricas de fora
-- da plataforma games e aplica somente para dentro da plataforma games (...) só
-- conta os likes, compartilhamentos, tempo online dentro da plataforma games".
--
-- ─── POR QUE UMA TABELA NOVA ────────────────────────────────────────────────
--
-- Das quatro métricas do ranking novo, TRÊS já existem e não precisam de nada:
-- curtida (portfolio_likes), comentário (tb_portfolio_comment) e
-- compartilhamento (tb_portfolio_event 'share') são registrados desde sempre, e
-- o que os torna "de games" é o vínculo do post com uma comunidade de
-- modalidade games (tb_community_feed_item, mig 160). A quarta — TEMPO ONLINE —
-- não existe em lugar nenhum da plataforma: ninguém nunca mediu quanto tempo
-- alguém passa numa tela. É isto que esta tabela passa a guardar.
--
-- ─── POR QUE POR DIA, E NÃO UM TOTAL ────────────────────────────────────────
--
-- Uma linha por (pessoa, dia) em vez de um contador único resolve duas coisas
-- de uma vez:
--
--   1. O TETO DIÁRIO. Sem ele, deixar a aba aberta a noite inteira venceria de
--      quem publica e conversa — o ranking premiaria o navegador ligado, não a
--      pessoa. Com o dia na chave, o teto é uma comparação trivial no UPSERT.
--   2. RECORTE POR PERÍODO depois. Se um dia o ranking virar "os últimos 30
--      dias", a soma já está fatiada por data — sem precisar guardar evento
--      cru, que numa batida a cada 2 minutos viraria a maior tabela do banco.
--
-- O dia é o de São Paulo (o mesmo fuso que o painel de engajamento usa), e não
-- UTC: quem joga às 22h de Brasília está no mesmo dia que quem joga às 9h, e
-- em UTC os dois cairiam em dias diferentes.
--
-- ─── COMO O TEMPO É CREDITADO (a regra mora no UPSERT, não no cliente) ──────
--
-- O navegador bate a cada 2 minutos enquanto a aba do ambiente games está
-- VISÍVEL, e a batida não diz quanto tempo passou — ela só diz "ainda estou
-- aqui". Quem calcula é o banco: o crédito é o tempo desde a última batida,
-- limitado por MAX_BEAT (ver utils/gamesScore.js). Isso fecha as duas pontas:
--
--   • um cliente adulterado não consegue reivindicar 5 horas numa batida só
--     (o limite é do servidor, e o servidor não acredita no relógio de fora);
--   • quem fecha o navegador e volta 3 horas depois não ganha as 3 horas —
--     ganha uma batida, porque presença é o que foi MEDIDO, não o intervalo
--     entre dois sinais.
--
-- A primeira batida do dia credita ZERO e só marca o início: creditar antes de
-- medir seria adivinhar.
--
-- ─── O QUE ESTA TABELA NÃO É ────────────────────────────────────────────────
--
-- Não é analytics e não é log: não guarda página, rota, sessão nem IP. Guarda
-- um inteiro de segundos por dia — o suficiente para ordenar uma fila, e nada
-- que descreva o que a pessoa fez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_games_presence (
  id_user      UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  day          DATE        NOT NULL,
  seconds      INTEGER     NOT NULL DEFAULT 0,
  last_beat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, day),
  -- O teto também é do BANCO, e não só do UPSERT: é a última linha de defesa
  -- para o dia em que alguém escrever aqui por outro caminho. 86400 = 24h, o
  -- máximo aritmeticamente possível num dia (o teto de negócio é bem menor e
  -- vive em utils/gamesScore.js).
  CONSTRAINT chk_games_presence_seconds
    CHECK (seconds >= 0 AND seconds <= 86400)
);

-- A varredura do ranking soma por pessoa; o dia entra quando houver recorte
-- por período. A PK (id_user, day) já serve os dois, mas o índice por dia
-- sozinho é o que torna barato "quem esteve online esta semana".
CREATE INDEX IF NOT EXISTS idx_games_presence_day
  ON public.tb_games_presence (day DESC);

COMMENT ON TABLE public.tb_games_presence IS
  'Segundos por dia dentro do ambiente de games (mig 226). Credito calculado no UPSERT a partir de last_beat_at, com teto por batida e por dia em utils/gamesScore.js.';
