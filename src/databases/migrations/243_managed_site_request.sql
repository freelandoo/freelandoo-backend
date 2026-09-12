-- =============================================================================
-- Migration 243: O CLIENTE PEDE O SITE — a fila que chega até nós
-- =============================================================================
-- Decisão do Alex (2026-09-12): "a pessoa pode apertar lá no site pronto e tem
-- que ter um botão pedir site; aí o admin recebe um modal mostrando que alguém
-- pediu site. Depois eu crio o site aqui, aponto a conta que esse site, e
-- disponibilizo o site pronto para a conta."
--
-- A 242 deu ao cliente o gesto de ACEITAR. Faltava o de PEDIR — e sem ele o
-- produto só existia para quem nós lembrássemos de procurar. O painel dizia
-- "fale com a gente pelo suporte", que é pedir à pessoa que saia da tela em que
-- ela está decidindo, para procurar um canal que ela não sabe qual é. Pedido
-- que depende de o cliente ter iniciativa fora do produto é pedido que não
-- acontece.
--
-- ─── POR QUE UMA TABELA, E NÃO UM STATUS A MAIS EM tb_managed_site_offer ────
--
-- São os dois lados da mesma conversa, e cada um tem um autor e um conteúdo
-- diferentes:
--
--   OFERTA  → escrita por NÓS, carrega `template` + `template_data` (o site).
--   PEDIDO  → escrito pelo CLIENTE, não carrega site nenhum — ele está pedindo
--             justamente o que ainda não existe.
--
-- Enfiar o pedido lá dentro obrigaria `template` a virar NULL-able, e com isso
-- a coluna deixaria de significar "o tema deste site" para significar "o tema,
-- quando houver" — a checagem que hoje é NOT NULL viraria responsabilidade de
-- quem lê. Pior: o índice parcial `WHERE status = 'pending'` da 242 é o que
-- garante UMA oferta viva; um pedido pendente passaria a ocupar essa vaga e
-- impediria de reservar a oferta que responde a ele.
--
-- ⚠️ UM PEDIDO VIVO POR COMUNIDADE (índice parcial próprio, mesma forma da
-- oferta, da fila de fraude da 201 e do vínculo de morador da 203). Apertar o
-- botão duas vezes é o caso comum — ansiedade, dúvida se funcionou — e sem o
-- índice a nossa fila encheria de linhas do mesmo negócio, empurrando para
-- baixo quem pediu depois.
--
-- ─── O PEDIDO SE FECHA SOZINHO QUANDO A OFERTA É RESERVADA ─────────────────
--
-- `answered` é gravado por `prepareOffer`, na MESMA transação que cria a oferta
-- — reservar o site É a resposta ao pedido. Deixar para um segundo clique faria
-- a fila continuar mostrando um negócio que já foi atendido, e o jeito de
-- descobrir seria abrir cada um. Fechar antes de a oferta existir seria pior:
-- se o INSERT da oferta falhasse, o pedido teria sumido sem nada no lugar.
--
-- `dismissed` existe para o pedido que NÃO vira site (o cliente desistiu,
-- ligamos e não fechou). Sem ele a fila só cresce, e fila que não esvazia é
-- fila que se aprende a ignorar — a mesma razão pela qual a matrícula cancelada
-- fica fora do alerta de ficha vencida (mig 189).
--
-- ⚠️ SEM `requireFeature` E SEM GATE DE PLANO na porta que grava aqui. Pedir um
-- orçamento é o começo da venda: cobrar plano para poder PEDIR é cobrar antes
-- de mostrar o produto. Quem decide se atende somos nós, olhando a fila.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_managed_site_request (
  id_request      UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- O pedido é DA COMUNIDADE, como a oferta: o site mora nela, e quem tem dois
  -- negócios precisa poder pedir para um sem que o outro seja atendido.
  id_profile      UUID NOT NULL
                    REFERENCES public.tb_profile (id_profile) ON DELETE CASCADE,

  -- Quem apertou. SET NULL e não CASCADE: apagar a conta de quem pediu não pode
  -- levar embora o registro de um negócio que continua existindo — e a
  -- liderança pode ter mudado desde então.
  requested_by_user UUID NULL
                    REFERENCES public.tb_user (id_user) ON DELETE SET NULL,

  -- O que a pessoa escreveu ("quero destacar o conserto de fogão industrial").
  -- Opcional de propósito: exigir texto transforma um clique em formulário, e
  -- o pedido mais valioso é o que a pessoa manda antes de saber o que quer.
  note            TEXT NULL,

  status          VARCHAR(16) NOT NULL DEFAULT 'pending',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Quando saiu de 'pending'. NULL enquanto espera na fila.
  decided_at      TIMESTAMPTZ NULL,
  decided_by_user UUID NULL
                    REFERENCES public.tb_user (id_user) ON DELETE SET NULL
);

-- CHECK NOMEADO: sem nome o Postgres gera um, e a próxima migration que
-- precisar alargar a lista teria de varrer o catálogo para achá-lo — foi o que
-- custou caro na vaga de condomínio (mig 198). O DROP antes do ADD mantém a
-- migration idempotente e deixa a lista alargável pelo nome.
ALTER TABLE public.tb_managed_site_request
  DROP CONSTRAINT IF EXISTS chk_managed_site_request_status;
ALTER TABLE public.tb_managed_site_request
  ADD CONSTRAINT chk_managed_site_request_status
  CHECK (status IN ('pending', 'answered', 'dismissed'));

-- ⚠️ A unicidade do pedido VIVO. É ela que faz o segundo clique no botão ser
-- inofensivo em vez de virar uma segunda linha na fila.
CREATE UNIQUE INDEX IF NOT EXISTS ux_managed_site_request_pending
  ON public.tb_managed_site_request (id_profile)
  WHERE status = 'pending';

-- A leitura da FILA: os pendentes, mais antigo primeiro (quem esperou mais é
-- atendido antes). Parcial porque a fila é sempre pequena dentro de uma tabela
-- que só cresce — mesma disciplina do sweeper de carência (mig 241) e do
-- WhatsApp ocioso (mig 224).
CREATE INDEX IF NOT EXISTS ix_managed_site_request_queue
  ON public.tb_managed_site_request (created_at)
  WHERE status = 'pending';

-- O histórico de uma comunidade (o painel de admin mostra o que já foi pedido).
CREATE INDEX IF NOT EXISTS ix_managed_site_request_profile
  ON public.tb_managed_site_request (id_profile, created_at DESC);

COMMENT ON TABLE public.tb_managed_site_request IS
  'Pedido de site pronto feito pelo lider da comunidade. Vira ofertas em tb_managed_site_offer quando a plataforma monta o site - o pedido e fechado como answered na MESMA transacao que cria a oferta.';
COMMENT ON COLUMN public.tb_managed_site_request.status IS
  'pending = na fila; answered = a oferta foi reservada; dismissed = nao virou site (desistencia, nao fechou).';
COMMENT ON COLUMN public.tb_managed_site_request.note IS
  'Texto livre do cliente. Opcional - exigir texto transformaria um clique em formulario.';
