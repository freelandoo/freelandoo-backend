-- =============================================================================
-- Migration 224: WhatsApp — desligar a sessão de quem parou de usar
-- =============================================================================
-- Pergunta do Alex (2026-09-06): "tem como desligar a instância depois de uma
-- inatividade?". Tem, e é o que impede o custo de crescer com quem abandona.
--
-- ─── POR QUE ISTO EXISTE, EM UMA FRASE ──────────────────────────────────────
--
-- Uma sessão do WhatsApp custa RAM enquanto está de pé, e ela fica de pé
-- sozinha: quem conecta e some custa exatamente o mesmo que quem atende todo
-- dia. É o oposto do perfil gamer (mig 220), onde a leitura só acontece quando
-- alguém abre a estante e o inativo custa zero. Aqui a linha precisa ficar viva
-- para receber — então o corte tem que ser deliberado.
--
-- ─── O QUE CONTA COMO "ATIVIDADE": O DONO, NÃO O REMETENTE ──────────────────
--
-- `last_seen_at` marca quando o DONO usou a caixa (abriu a aba, leu uma
-- conversa, respondeu). NÃO é a última mensagem recebida, e a diferença é o
-- ponto todo: um número pode receber mensagem todo dia e mesmo assim ter sido
-- abandonado aqui dentro — é justamente esse caso que consome RAM sem entregar
-- nada a ninguém.
--
-- ─── DESLIGAR NÃO É PERDER MENSAGEM (e é por isso que é seguro) ─────────────
--
-- A nossa sessão é um APARELHO CONECTADO do WhatsApp da pessoa, como o
-- WhatsApp Web. Desconectá-la não derruba o número: as mensagens continuam
-- chegando no celular dela normalmente — só param de entrar nesta caixa até
-- ela reconectar. E o histórico já recebido FICA (a instância e as conversas
-- não são apagadas, só a sessão cai).
--
-- ─── POR QUE `disconnect_reason` E NÃO SÓ O STATUS ──────────────────────────
--
-- Sem ele, quem voltasse depois de um mês encontraria o botão "Conectar" de
-- novo e concluiria que o produto quebrou ou perdeu a conexão sozinho. Com ele
-- a tela DIZ o que aconteceu e por quê. Um desconectado silencioso é
-- indistinguível de um defeito.
--
-- Idempotente. Sem backfill de dados: a coluna nasce com DEFAULT NOW(), o que
-- dá a janela inteira a partir daqui para quem já estiver conectado (hoje,
-- ninguém — a mig 223 é de horas atrás).
-- =============================================================================

ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS disconnect_reason VARCHAR(16) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_whatsapp_disconnect_reason'
  ) THEN
    ALTER TABLE public.tb_whatsapp_instance
      ADD CONSTRAINT chk_whatsapp_disconnect_reason
      -- NULL = está conectada, ou nunca chegou a conectar.
      -- 'user' = a pessoa desligou. 'idle' = o sweeper desligou por inatividade.
      CHECK (disconnect_reason IS NULL OR disconnect_reason IN ('user', 'idle'));
  END IF;
END $$;

-- O sweeper varre só o que está DE PÉ e parado. Índice parcial: a varredura
-- roda a cada 6h e não pode passar pela tabela inteira quando ela crescer.
CREATE INDEX IF NOT EXISTS ix_whatsapp_instance_idle
  ON public.tb_whatsapp_instance (last_seen_at)
  WHERE status = 'connected';
