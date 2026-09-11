-- 240_whatsapp_cloud_provider.sql
-- WhatsApp: a instância passa a saber de QUAL PROVEDOR ela é.
--
-- ─── POR QUE ESTA MIGRATION EXISTE ──────────────────────────────────────────
--
-- A mig 223 modelou o WhatsApp do usuário em cima da Evolution API (Baileys),
-- que é cliente NÃO-OFICIAL: ela se passa por WhatsApp Web, viola os Termos da
-- Meta, e o número do usuário pode ser banido — PERMANENTEMENTE e sem recurso.
-- A migração para a Cloud API oficial começa aqui, e começa pelo banco porque
-- os dois provedores precisam conviver: desligar a Evolution antes do oficial
-- estar de pé deixaria todo mundo sem canal nenhum.
--
-- ─── `evolution_instance` FICA COM O NOME, E PASSA A MENTIR ─────────────────
--
-- Ela vira o `provider_ref` GENÉRICO: na Evolution guarda o nome da instância,
-- na Cloud guarda o `phone_number_id`. O nome físico é LEGADO, exatamente como
-- `tb_machine` (que guarda enxames) e `tb_games_presence` (que guarda a
-- presença do Financeiro): **rename é só de aplicação**. Renomear a coluna que
-- a 223 criou quebraria a migration histórica, que o runner re-executa em banco
-- virgem e cujo checksum ele confere no boot.
--
-- ─── O UNIQUE PRECISA DO PROVEDOR JUNTO ─────────────────────────────────────
--
-- O índice da 223 é único sobre `evolution_instance` sozinho. Os dois
-- provedores têm espaços de id DIFERENTES (um nome derivado do id_user × um
-- id numérico da Meta), e sem o provedor na chave uma colisão improvável seria
-- resolvida errado: a mensagem de um cliente cairia na caixa de outro, que é a
-- falha que a 223 inteira existe para impedir.
--
-- ─── O QUE NÃO ESTÁ AQUI, E POR QUÊ ─────────────────────────────────────────
--
-- Não há coluna para a janela de atendimento de 24h nesta tabela: ela é da
-- CONVERSA, não da instância — cada cliente abre a sua ao escrever. Ela entra
-- em `tb_whatsapp_conversation`, abaixo.

-- ─── 1. De qual provedor é esta instância ───────────────────────────────────

ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS provider VARCHAR(16) NOT NULL DEFAULT 'evolution';

-- Lista FECHADA. O valor vira literal em decisão de código (qual adaptador
-- chamar, quem o sweeper pode desligar); um valor inventado por UPDATE cru
-- deixaria a linha sem adaptador e a pessoa sem canal, sem erro aparecer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_whatsapp_instance_provider'
  ) THEN
    ALTER TABLE public.tb_whatsapp_instance
      ADD CONSTRAINT chk_whatsapp_instance_provider
      CHECK (provider IN ('evolution', 'cloud'));
  END IF;
END $$;

-- ─── 2. O que só a Cloud API tem ────────────────────────────────────────────

-- O WhatsApp Business Account dono do número. Na FASE 1 é sempre o da
-- Freelandoo (os números moram no nosso portfólio, e o método de pagamento é
-- um só, nosso); na fase 2 (Tech Provider) passa a ser o WABA do cliente.
-- Guardado por linha desde já para que a fase 2 não precise de migration.
ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS waba_id VARCHAR(32) NULL;

-- Token de acesso CIFRADO (utils/secretBox.js, o mesmo cofre do token das
-- academias). NULL na fase 1: lá quem opera é o System User token do ambiente,
-- porque o WABA é nosso. A coluna existe desde já porque na fase 2 cada cliente
-- traz o token dele, e é ela que separa "credencial do servidor" de
-- "credencial daquele cliente".
--
-- ⚠️ NUNCA gravar token em claro aqui, e NUNCA devolvê-lo por API — nem para o
-- dono da instância. Mesma regra da apikey da Evolution.
ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS access_token_sealed TEXT NULL;

-- ─── 3. Qualidade do número (alimentado pelo W6) ────────────────────────────
--
-- ⚠️ ISTO NÃO É ENFEITE DE PAINEL. Na coexistência o número continua no app do
-- profissional, então o que ele faz FORA da Freelandoo afeta um número que está
-- no NOSSO portfólio. A punição direta é dele (o número vira FLAGGED), mas o
-- crescimento é nosso: a escala automática do limite de números depende da
-- qualidade agregada de TODOS os números do portfólio. Um número ruim trava o
-- teto para todo mundo.
--
-- Sem guardar isto, o sintoma chega como "o limite parou de crescer" e não há
-- como saber quem causou.
ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS quality_rating VARCHAR(16) NULL;

ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS number_status VARCHAR(24) NULL;

ALTER TABLE public.tb_whatsapp_instance
  ADD COLUMN IF NOT EXISTS quality_checked_at TIMESTAMPTZ NULL;

-- ─── 4. O UNIQUE passa a considerar o provedor ──────────────────────────────

DROP INDEX IF EXISTS public.ux_whatsapp_instance_name;

CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_instance_provider_ref
  ON public.tb_whatsapp_instance (provider, evolution_instance);

-- ─── 5. A janela de atendimento de 24h ──────────────────────────────────────
--
-- Regra da Meta que NÃO existe na Evolution: só dá para responder texto livre
-- enquanto a janela aberta pelo cliente estiver de pé. Fora dela a Meta RECUSA,
-- e sem guardar isto a recusa chegaria depois de a pessoa já ter digitado.
--
-- ⚠️ NULL = FECHADA, nunca "aberta por omissão". Errar para o lado aberto faz a
-- tela prometer um envio que o provedor vai negar; errar para o lado fechado só
-- pede que o cliente escreva primeiro, que é a verdade do canal.
--
-- Quem preenche é o WEBHOOK, ao receber mensagem do cliente (W2): é ele que
-- sabe quando o cliente falou. Calcular no envio seria adivinhar.
ALTER TABLE public.tb_whatsapp_conversation
  ADD COLUMN IF NOT EXISTS service_window_expires_at TIMESTAMPTZ NULL;

-- ─── 6. Folga para o id de mensagem da Meta ─────────────────────────────────
--
-- O `wamid.*` da Cloud API é bem mais longo que o id do Baileys. VARCHAR(128)
-- provavelmente caberia, mas truncar id de mensagem quebra a deduplicação — e
-- a Meta entrega at-least-once, então a deduplicação é o que impede a mesma
-- mensagem de aparecer duas vezes na caixa.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tb_whatsapp_message'
      AND column_name = 'wa_message_id'
      AND character_maximum_length < 255
  ) THEN
    ALTER TABLE public.tb_whatsapp_message
      ALTER COLUMN wa_message_id TYPE VARCHAR(255);
  END IF;
END $$;

-- ─── 7. Índice para o sweeper e para o painel de qualidade ──────────────────
--
-- O sweeper da mig 224 varre só instâncias CONECTADAS, e agora só as da
-- EVOLUTION (na Cloud API não há sessão a desligar — ver o comentário em
-- WhatsappService.sweepIdleInstances). O painel de qualidade do W6 varre por
-- provedor também.
CREATE INDEX IF NOT EXISTS ix_whatsapp_instance_provider_status
  ON public.tb_whatsapp_instance (provider, status);
