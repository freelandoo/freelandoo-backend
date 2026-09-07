-- =============================================================================
-- Migration 223: WhatsApp do usuário dentro da Freelandoo (Evolution API)
-- =============================================================================
-- Pedido do Alex (2026-09-06): a aba O.S. de /mensagens ganha duas abas —
-- Freelandoo e WhatsApp — e "todos os usuários que quiserem conectar o próprio
-- WhatsApp deles" possam fazê-lo aqui dentro: clicou, aparece o QR Code.
--
-- A referência é o Atendimento do Coliseu (`src/lib/whatsapp/*`), que já fala
-- com a Evolution API v2. O que foi copiado é o CONTRATO com a Evolution — o
-- ciclo criar → conectar → QR → connection.update → messages.upsert. O modelo
-- de dados NÃO pôde ser copiado, e é isso que esta migration resolve.
--
-- ─── A DIFERENÇA QUE DESENHA O SCHEMA INTEIRO: LÁ É UMA, AQUI É UMA POR PESSOA ─
--
-- No Coliseu existe UM WhatsApp (o da academia): a instância é escolhida por
-- ENV (`EVOLUTION_INSTANCE`) e a ingestão do webhook chama `instanciaAtualRepo()`
-- — quer dizer, "a instância", no singular, ignorando de qual instância o
-- evento veio. Aqui isso seria um vazamento silencioso: a mensagem de um
-- usuário cairia na caixa de outro, sem erro nenhum aparecer.
--
-- Por isso `evolution_instance` é UNIQUE e é a CHAVE DE ROTEAMENTO: o webhook
-- traz o nome da instância, e é ele que diz de quem é a conversa. O nome é
-- derivado do `id_user` (ver `src/utils/whatsappInstance.js`), nunca digitado.
--
-- ─── POR QUE NÃO EXISTE COLUNA DE CREDENCIAL ────────────────────────────────
--
-- A credencial da Evolution (`EVOLUTION_URL` + `EVOLUTION_API_KEY`) é do
-- SERVIDOR, uma só, e nunca sai do backend. O que pertence à pessoa é a
-- SESSÃO do WhatsApp dela, e essa mora na Evolution (Baileys), não aqui —
-- o pareamento é feito pelo celular dela contra o QR. Uma coluna
-- `token_sealed` vazia seria o convite da mig 220: alguém guardaria
-- credencial de terceiro sem passar pela decisão de guardar.
--
-- ─── O QUE A CAIXA GUARDA, E O QUE ELA NÃO GUARDA ───────────────────────────
--
-- Texto e metadado da mensagem ficam aqui — é o que a lista e a conversa
-- precisam desenhar sem ir à rede. O BINÁRIO da mídia NÃO: foto, áudio e
-- vídeo continuam na Evolution e são buscados sob demanda quando alguém abre
-- a mensagem. Guardar o arquivo aqui poria mídia de terceiro (que nunca
-- consentiu com a Freelandoo) em repouso no nosso R2, e por prazo indefinido.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. A instância: o WhatsApp de UMA pessoa ───────────────────────────────
-- Uma linha por usuário (`ux_whatsapp_instance_user`), e ela SOBREVIVE ao
-- desconectar: o histórico de conversas pende dela, e apagá-la ao desconectar
-- apagaria a caixa de entrada de quem só trocou de aparelho.
--
-- `status` e não um booleano `conectado`, pela razão da mig 214 (domínio
-- próprio): o ciclo tem três estados que pedem instrução DIFERENTE na tela.
--   disconnected → nunca pareou, ou saiu. A tela oferece o QR.
--   connecting   → QR gerado, esperando o celular ler. Estado de PASSAGEM: a
--                  Evolution emite `connecting` também durante a reconexão, e
--                  tratá-lo como queda marcava a sessão como caída no meio de
--                  uma conversa saudável (bug que o Coliseu pagou).
--   connected    → sessão aberta.
CREATE TABLE IF NOT EXISTS public.tb_whatsapp_instance (
  id_instance        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user            UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- Nome técnico na Evolution. É a chave de roteamento do webhook, por isso
  -- UNIQUE global e não apenas por usuário.
  evolution_instance VARCHAR(64) NOT NULL,
  status             VARCHAR(16) NOT NULL DEFAULT 'disconnected',
  -- Só dígitos, o número que pareou. Serve para a pessoa conferir QUAL
  -- WhatsApp está ligado antes de responder por ele.
  connected_number   VARCHAR(24) NULL,
  last_state_at      TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_whatsapp_instance_status'
  ) THEN
    ALTER TABLE public.tb_whatsapp_instance
      ADD CONSTRAINT chk_whatsapp_instance_status
      CHECK (status IN ('disconnected', 'connecting', 'connected'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_instance_user
  ON public.tb_whatsapp_instance (id_user);

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_instance_name
  ON public.tb_whatsapp_instance (evolution_instance);

-- ─── 2. A conversa ──────────────────────────────────────────────────────────
-- Endereçada pelo `remote_jid`, que é o endereço do WhatsApp — telefone
-- (`5511...@s.whatsapp.net`), grupo (`120363...@g.us`) ou `@lid` (identificador
-- opaco que o WhatsApp usa quando NÃO expõe o número).
--
-- `phone` fica vazio nesses dois últimos casos, e isso é correto: extrair
-- dígitos do `120363...` de um grupo produziria um telefone que não existe.
--
-- `is_group` é coluna e não dedução do sufixo porque a lista pergunta isso a
-- cada linha, e porque em grupo o `push_name` do evento é de QUEM ESCREVEU, não
-- do grupo — sem a marca, o título da conversa trocaria a cada mensagem.
CREATE TABLE IF NOT EXISTS public.tb_whatsapp_conversation (
  id_conversation      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_instance          UUID NOT NULL REFERENCES public.tb_whatsapp_instance(id_instance) ON DELETE CASCADE,
  remote_jid           VARCHAR(160) NOT NULL,
  phone                VARCHAR(24) NOT NULL DEFAULT '',
  push_name            VARCHAR(160) NULL,
  is_group             BOOLEAN NOT NULL DEFAULT FALSE,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  last_message_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_preview TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_conversation_jid
  ON public.tb_whatsapp_conversation (id_instance, remote_jid);

CREATE INDEX IF NOT EXISTS ix_whatsapp_conversation_recent
  ON public.tb_whatsapp_conversation (id_instance, last_message_at DESC);

-- ─── 3. A mensagem ──────────────────────────────────────────────────────────
-- `wa_message_id` é o `key.id` do WhatsApp, e o índice UNIQUE parcial sobre ele
-- é o que torna a ingestão SEGURA DE REPETIR: a Evolution reentrega o webhook
-- quando a resposta demora, e o que sai daqui pelo nosso lado volta como eco
-- do próprio WhatsApp. Sem ele a conversa mostraria a mesma frase duas vezes.
--
-- Parcial (`WHERE wa_message_id IS NOT NULL`) porque a mensagem que ACABAMOS de
-- enviar nasce sem id — a Evolution nem sempre devolve o `key.id` na resposta
-- do envio, e um NULL não pode disputar unicidade com outro NULL.
--
-- `direction` cobre também o que a pessoa responder pelo CELULAR dela: o eco
-- vem com `fromMe` e entra como 'out', para a conversa aqui ser a conversa
-- inteira e não a metade que passou por nós.
CREATE TABLE IF NOT EXISTS public.tb_whatsapp_message (
  id_message      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_conversation UUID NOT NULL REFERENCES public.tb_whatsapp_conversation(id_conversation) ON DELETE CASCADE,
  wa_message_id   VARCHAR(128) NULL,
  direction       VARCHAR(3) NOT NULL,
  -- Em grupo: quem escreveu (nome de perfil ou telefone formatado). Em conversa
  -- de duas pessoas fica NULL — o autor já é o título da conversa.
  sender_label    VARCHAR(160) NULL,
  body            TEXT NOT NULL DEFAULT '',
  -- 'text' quando é texto; nos demais, o `body` carrega a legenda ou o rótulo
  -- ("📷 Imagem") e o arquivo é buscado na Evolution sob demanda.
  media_type      VARCHAR(16) NOT NULL DEFAULT 'text',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_whatsapp_message_direction'
  ) THEN
    ALTER TABLE public.tb_whatsapp_message
      ADD CONSTRAINT chk_whatsapp_message_direction
      CHECK (direction IN ('in', 'out'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_whatsapp_message_media'
  ) THEN
    ALTER TABLE public.tb_whatsapp_message
      ADD CONSTRAINT chk_whatsapp_message_media
      CHECK (media_type IN ('text', 'image', 'audio', 'video', 'document', 'other'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_message_wa_id
  ON public.tb_whatsapp_message (id_conversation, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_whatsapp_message_thread
  ON public.tb_whatsapp_message (id_conversation, sent_at DESC);

-- ─── 4. Kill-switch ─────────────────────────────────────────────────────────
-- Nasce LIGADA, como as outras flags de superfície: o Painel de Controle serve
-- para DESLIGAR se a Evolution cair ou se a operação precisar segurar.
--
-- ⚠️ A flag NÃO decide se a aba WhatsApp aparece conectável: quem decide é a
-- ENV (`EVOLUTION_URL` + `EVOLUTION_API_KEY`), pela regra que a mig 214 deixou
-- escrita e a 220 repetiu — flag ligada sem credencial produz um botão que só
-- falha DEPOIS do clique. Sem ENV a aba diz que a integração não está
-- configurada, em vez de oferecer um QR que nunca vem.
INSERT INTO public.tb_feature_flag (flag_key, label, description, is_enabled)
VALUES
  ('whatsapp_atendimento', 'WhatsApp: conectar o próprio número',
   'Aba WhatsApp dentro de Solicitações (/mensagens): a pessoa conecta o WhatsApp dela por QR Code e atende as conversas dentro da Freelandoo. Desligar esconde a aba e bloqueia conexão e envio; o histórico já recebido é preservado. Só aparece conectável se EVOLUTION_URL e EVOLUTION_API_KEY estiverem configuradas.',
   TRUE)
ON CONFLICT (flag_key) DO NOTHING;
