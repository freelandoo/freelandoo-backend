-- =============================================================================
-- Migration 253: O ATENDENTE PASSA A MORAR AQUI DENTRO — chaves do admin, base
-- de conhecimento, fila de resposta e medidor de tokens.
--
-- ─── O QUE MUDA DE LUGAR (é a parte que morde) ──────────────────────────────
--
-- A mig 175 vendia um atendente e NUNCA respondeu ninguém: o cérebro morava num
-- bot externo (`pjcodeworks-agent`) que jamais subiu — `ATENDIMENTO_BOT_URL` e
-- `ATENDIMENTO_BOT_SECRET` seguem ausentes do ambiente desde 2026-07-05. O que
-- existia aqui era só a cobrança e o push de provisionamento para o vazio.
--
-- Agora o cérebro é NOSSO. A mig 175 NÃO é desfeita: ela continua sendo a venda
-- (plano, preço, `token_limit_monthly`), e é ela que um dia decide QUEM tem
-- direito. O que entra aqui é o que faltava — a chave, o contexto e as mãos.
--
-- ⚠️ A CHAVE É GLOBAL E É DA PLATAFORMA (decisão do Alex, 2026-09-17). Quem
-- paga a conta da Anthropic/OpenAI é a Freelandoo, e é por isso que o medidor
-- (`tb_ai_usage`) não é enfeite: sem ele um único usuário consome o mês inteiro
-- e ninguém descobre antes da fatura.
--
-- ─── A CHAVE É O INTERRUPTOR DE VERDADE ─────────────────────────────────────
--
-- A flag `atendimento_ai` nasce LIGADA, e isso é seguro por construção: sem
-- nenhuma linha em `tb_ai_provider_key` não há como chamar LLM nenhum, então o
-- subsistema fica inerte até alguém colar a primeira chave. Ligar a flag antes
-- da chave não responde a ninguém; desligá-la depois para tudo na hora.
--
-- ─── POR QUE EXISTE UMA FILA (e ela NÃO é cerimônia) ────────────────────────
--
-- Duas razões independentes, e cada uma sozinha já bastaria:
--
--   1. O INVARIANTE DA META. `WhatsappCloudIngestService` não pode alcançar
--      quem ENVIA — é o que `test/unit/whatsappIngestIsolation.test.js` prova
--      pelo fecho transitivo dos `require`, e é o que sustenta, perante a Meta,
--      que a plataforma não opera ferramenta de disparo. A ingestão ENFILEIRA
--      (só escreve uma linha aqui) e um worker separado responde. O caminho de
--      código de "mensagem que chega" para "mensagem que sai" continua não
--      existindo — o que existe é uma fila no meio, que é outra coisa.
--
--   2. OS 22 SEGUNDOS DA META. O webhook precisa devolver 2xx em 22s ou a
--      notificação é re-entregue a cada 15 min. Uma chamada de LLM leva
--      segundos e às vezes dezenas deles: responder DENTRO do webhook
--      transformaria latência do modelo em tempestade de re-entrega.
--
-- ⚠️ E É POR ISSO QUE A FILA TEM DEDUPE POR MENSAGEM DISPARADORA. O webhook é
-- at-least-once: sem o índice parcial abaixo, cada re-entrega da MESMA mensagem
-- enfileiraria outra resposta e o cliente receberia o mesmo texto três vezes.
--
-- Idempotente (CREATE ... IF NOT EXISTS, DROP CONSTRAINT antes de ADD).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. AS DUAS CHAVES
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ A PK É O PROVEDOR, e é ela que materializa o "até duas APIs": uma linha
-- por provedor conhecido, e o CHECK é a lista fechada. Provedor novo entra no
-- CHECK numa migration nova E no registry `src/integrations/ai/` — declarado
-- só num dos dois, ele é aceito no banco e estoura na hora de responder.
--
-- ⚠️ `api_key_sealed` É SELADA (utils/secretBox, AES-256-GCM). Coluna selada
-- nova ENTRA NA LISTA `ALVOS` de `scripts/reseal-secrets.js` — fora dela ela
-- fica presa ao `JWT_SECRET` para sempre e ninguém descobre até a rotação
-- quebrar justamente este recurso.
--
-- ⚠️ `key_hint` guarda os ÚLTIMOS 4 caracteres, nunca a chave. Ele existe para
-- o admin conferir NA TELA qual chave está lá sem que a plataforma precise
-- reexibir o segredo — reexibir seria transformar o painel num vazamento.
CREATE TABLE IF NOT EXISTS public.tb_ai_provider_key (
  provider        VARCHAR(16)   PRIMARY KEY,
  label           TEXT          NULL,
  api_key_sealed  TEXT          NOT NULL,
  key_hint        VARCHAR(8)    NOT NULL,
  model           TEXT          NOT NULL,
  is_enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
  -- 1 = principal, 2 = reserva. O empate é resolvido pelo nome do provedor,
  -- para que a ordem NUNCA dependa da ordem de inserção.
  priority        SMALLINT      NOT NULL DEFAULT 1,
  -- ⚠️ O PREÇO É COLUNA, NÃO TABELA EM CONSTANTE. Preço de modelo muda, e uma
  -- tabela hardcoded envelhece em silêncio: o painel seguiria somando o valor
  -- velho com cara de medido. Aqui o admin escreve o que ELE paga, por milhão
  -- de tokens, e é isso que a conta usa.
  --
  -- ⚠️ NULL É "NÃO INFORMADO", E NÃO ZERO. Sem preço, `tb_ai_usage.cost_usd`
  -- fica NULL e a tela diz "custo não apurado" em vez de R$ 0,00 — os tokens
  -- continuam sendo contados, que é o medidor que importa.
  price_in_mtok   NUMERIC(10,4) NULL,
  price_out_mtok  NUMERIC(10,4) NULL,
  last_ok_at      TIMESTAMPTZ   NULL,
  last_error      TEXT          NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by      UUID          NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

ALTER TABLE public.tb_ai_provider_key
  DROP CONSTRAINT IF EXISTS tb_ai_provider_key_provider_chk;
ALTER TABLE public.tb_ai_provider_key
  ADD CONSTRAINT tb_ai_provider_key_provider_chk
  CHECK (provider IN ('anthropic','openai'));

ALTER TABLE public.tb_ai_provider_key
  DROP CONSTRAINT IF EXISTS tb_ai_provider_key_priority_chk;
ALTER TABLE public.tb_ai_provider_key
  ADD CONSTRAINT tb_ai_provider_key_priority_chk
  CHECK (priority BETWEEN 1 AND 2);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A BASE DE CONHECIMENTO (o que o dono escreve ou manda em PDF)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ GUARDA TEXTO, NÃO O PDF. O modelo lê texto; manter o binário obrigaria a
-- re-extrair a cada resposta — trabalho repetido no caminho mais quente — e
-- deixaria em repouso um arquivo que, depois de extraído, não serve a mais
-- nada. A extração acontece UMA vez, no upload.
--
-- ⚠️ `is_active` em vez de DELETE: o dono desliga um documento sem perder o
-- texto que escreveu, e religa depois. Excluir de verdade continua existindo
-- (DELETE na rota), mas desligar é o gesto barato.
CREATE TABLE IF NOT EXISTS public.tb_ai_knowledge (
  id_knowledge  BIGSERIAL     PRIMARY KEY,
  id_user       UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  source        VARCHAR(8)    NOT NULL DEFAULT 'text',
  title         TEXT          NOT NULL,
  content       TEXT          NOT NULL,
  file_name     TEXT          NULL,
  char_count    INTEGER       NOT NULL DEFAULT 0,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_ai_knowledge
  DROP CONSTRAINT IF EXISTS tb_ai_knowledge_source_chk;
ALTER TABLE public.tb_ai_knowledge
  ADD CONSTRAINT tb_ai_knowledge_source_chk
  CHECK (source IN ('text','pdf'));

CREATE INDEX IF NOT EXISTS ix_ai_knowledge_user
  ON public.tb_ai_knowledge (id_user, is_active);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A FILA
-- ─────────────────────────────────────────────────────────────────────────────
-- `ref_id` é TEXT porque os três canais endereçam diferente: DM e WhatsApp por
-- `id_conversation` (UUID/bigint conforme a tabela) e O.S. por `id_response`.
-- Guardar como texto evita três colunas nulas e mantém a fila com uma forma só.
CREATE TABLE IF NOT EXISTS public.tb_ai_reply_job (
  id_job              BIGSERIAL     PRIMARY KEY,
  id_user             UUID          NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  channel             VARCHAR(10)   NOT NULL,
  ref_id              TEXT          NOT NULL,
  -- A mensagem que disparou. É a chave do dedupe; NULL só em disparo manual
  -- ("responder agora" do painel), que por definição nasce de um clique.
  trigger_message_id  TEXT          NULL,
  trigger_text        TEXT          NULL,
  status              VARCHAR(10)   NOT NULL DEFAULT 'pending',
  attempts            SMALLINT      NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  answer              TEXT          NULL,
  skip_reason         TEXT          NULL,
  last_error          TEXT          NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tb_ai_reply_job
  DROP CONSTRAINT IF EXISTS tb_ai_reply_job_channel_chk;
ALTER TABLE public.tb_ai_reply_job
  ADD CONSTRAINT tb_ai_reply_job_channel_chk
  CHECK (channel IN ('whatsapp','dm','os'));

ALTER TABLE public.tb_ai_reply_job
  DROP CONSTRAINT IF EXISTS tb_ai_reply_job_status_chk;
ALTER TABLE public.tb_ai_reply_job
  ADD CONSTRAINT tb_ai_reply_job_status_chk
  CHECK (status IN ('pending','running','done','failed','skipped'));

-- ⚠️ O DEDUPE DO WEBHOOK AT-LEAST-ONCE. Parcial porque o disparo manual nasce
-- sem mensagem disparadora, e um UNIQUE cego recusaria o segundo clique.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_reply_job_trigger
  ON public.tb_ai_reply_job (channel, trigger_message_id)
  WHERE trigger_message_id IS NOT NULL;

-- O worker varre por isto. Parcial: o que já terminou não é mais varrido.
CREATE INDEX IF NOT EXISTS ix_ai_reply_job_due
  ON public.tb_ai_reply_job (next_attempt_at)
  WHERE status IN ('pending','running');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O MEDIDOR
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ `cost_usd` é NULL-able DE PROPÓSITO, e NULL não é zero: quando o modelo
-- não está na tabela de preços, a plataforma não sabe quanto gastou. Gravar
-- zero ali faria o painel somar R$ 0,00 sobre chamadas que custaram dinheiro —
-- a pior mentira possível numa tela sobre custo.
CREATE TABLE IF NOT EXISTS public.tb_ai_usage (
  id_usage       BIGSERIAL      PRIMARY KEY,
  id_user        UUID           NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  id_job         BIGINT         NULL REFERENCES public.tb_ai_reply_job(id_job) ON DELETE SET NULL,
  provider       VARCHAR(16)    NOT NULL,
  model          TEXT           NOT NULL,
  channel        VARCHAR(10)    NULL,
  input_tokens   INTEGER        NOT NULL DEFAULT 0,
  output_tokens  INTEGER        NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(12,6)  NULL,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_ai_usage_user_time
  ON public.tb_ai_usage (id_user, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_ai_usage_time
  ON public.tb_ai_usage (created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. O SELO "respondido pela IA"
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ SUPERSET COM O MESMO NOME DE CONSTRAINT (regra das migs 153/197/206):
-- 'app' e 'api' continuam valendo. Nome novo deixaria a constraint antiga de pé
-- em paralelo, e ela recusaria 'ai' — o sintoma seria a IA falhar ao gravar a
-- resposta DEPOIS de já ter falado com o cliente.
--
-- Cabe em VARCHAR(8) sem alargar a coluna (conferido: 'ai' tem 2 caracteres).
ALTER TABLE public.tb_message
  DROP CONSTRAINT IF EXISTS tb_message_sent_via_chk;
ALTER TABLE public.tb_message
  ADD CONSTRAINT tb_message_sent_via_chk
  CHECK (sent_via IN ('app','api','ai'));

ALTER TABLE public.tb_service_request_message
  DROP CONSTRAINT IF EXISTS tb_service_request_message_sent_via_chk;
ALTER TABLE public.tb_service_request_message
  ADD CONSTRAINT tb_service_request_message_sent_via_chk
  CHECK (sent_via IN ('app','api','ai'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. O KILL-SWITCH
-- ─────────────────────────────────────────────────────────────────────────────
-- Nasce LIGADA: sem chave cadastrada o subsistema é inerte, então a flag serve
-- para DESLIGAR depressa, não para liberar.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'atendimento_ai',
  'Atendimento com IA',
  'O atendente da plataforma: lê o perfil, a loja, os serviços e a base de conhecimento do dono e responde nas mensagens da Freelandoo e no WhatsApp conectado. Sem chave de provedor cadastrada no painel, nada acontece.',
  TRUE
)
ON CONFLICT (flag_key) DO NOTHING;

-- ⚠️ UM INTERRUPTOR POR CANAL, e não um só, porque os dois canais têm RISCOS
-- DIFERENTES. Responder dentro da Freelandoo não tem exposição com ninguém;
-- responder no WhatsApp acontece num número que, na fase 1, mora no Business
-- Portfolio DA FREELANDOO — um problema ali alcança o número de todos os
-- clientes, não só o de quem causou.
--
-- Com um interruptor só, conter um problema no WhatsApp obrigaria a derrubar
-- também o atendimento de dentro da plataforma, que não tem nada a ver.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'atendimento_ai_whatsapp',
  'Atendimento com IA — responder no WhatsApp',
  'Deixa o atendente responder automaticamente no WhatsApp conectado. Ele só responde DENTRO da janela de 24h e só a quem escreveu primeiro: nunca inicia conversa e nunca usa template. Desligar para de responder na hora; as mensagens continuam chegando normalmente na caixa.',
  TRUE
)
ON CONFLICT (flag_key) DO NOTHING;

INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES (
  'atendimento_ai_freelandoo',
  'Atendimento com IA — responder na Freelandoo',
  'Deixa o atendente responder automaticamente nas mensagens diretas e nas O.S. da própria plataforma.',
  TRUE
)
ON CONFLICT (flag_key) DO NOTHING;
