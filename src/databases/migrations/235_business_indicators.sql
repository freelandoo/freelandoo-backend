-- =============================================================================
-- Migration 235: INDICADORES DO NEGÓCIO — o que o site fez, num contador
-- =============================================================================
-- Pedido do Alex (2026-09-10): "Eu preciso de indicadores no meu negócio. Ele é
-- atrelado ao WhatsApp e ao mensagens do O.S. — então tudo que recebe de
-- mensagem no zap e no O.S. vira indicador de LEAD. Também precisa de
-- VISUALIZAÇÕES do site e CLIQUES no botão de agendamento. E faturamento."
--
-- ─── TRÊS DOS QUATRO NÚMEROS JÁ EXISTEM NO BANCO ────────────────────────────
--
-- LEAD sai de `tb_whatsapp_message` (mig 223) e das mensagens de O.S.
-- (`tb_service_request_message` da mig 023 e `tb_product_request_message` da
-- 135). FATURAMENTO sai de `tb_profile_bookings` com `id_origin_community`
-- (mig 227 — a coluna que diz que o agendamento veio PELO SITE) e de
-- `tb_community_member_payment` (mig 173). Nenhum deles pede tabela nova, e
-- criar uma "tabela de indicadores" que copiasse esses totais seria a segunda
-- verdade de sempre: o dia em que um reembolso mexesse numa e não na outra, o
-- painel mentiria sem errar.
--
-- O QUE NÃO EXISTE é o que o VISITANTE ANÔNIMO faz no site publicado: ninguém
-- nunca contou uma visualização nem um clique. É só isso que esta migration
-- cria.
--
-- ─── POR QUE AGREGADO POR DIA, E NÃO UMA LINHA POR EVENTO ───────────────────
--
-- Um site publicado é a superfície mais visitada que temos e a que robô varre
-- sem parar. Guardar um evento cru por visita faria desta a maior tabela do
-- banco em poucos meses, para responder a uma pergunta ("quantas visitas em
-- setembro?") que o agregado responde com uma linha por dia. É a MESMA escolha
-- da `tb_games_presence` (mig 226): por dia, com UPSERT, sem sweeper e sem
-- job de limpeza.
--
-- O preço é declarado: não dá para saber a HORA de uma visita nem separar
-- visitante único de visita repetida. A hora ninguém pediu; a repetição é
-- cuidada do lado do cliente, que manda uma `view` por sessão do navegador —
-- então o número é "visitas", não "recarregamentos de página".
--
-- ─── O DIA É O DE SÃO PAULO, E QUEM O ESCOLHE É O SERVIDOR ──────────────────
--
-- Em UTC, tudo que acontece depois das 21h cairia no dia seguinte — o painel
-- de uma barbearia mostraria o movimento da noite de sexta no sábado. E a data
-- NUNCA vem do cliente: o relógio do visitante é dele, e um aparelho com a
-- data errada (ou adulterada) escreveria movimento em dias em que a loja
-- estava fechada.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── O contador do site ─────────────────────────────────────────────────────
-- Uma linha por (comunidade, dia, tipo de evento).
--
-- `kind` é lista FECHADA, e a lista é a mesma de `src/utils/siteEvents.js` —
-- que é quem a porta pública consulta antes de gravar. Sem o CHECK, um POST
-- com `kind: "qualquer_coisa"` criaria categorias que nenhuma tela desenha e
-- que ninguém perceberia até alguém somar os totais e ver que não fecham.
--
--   view            alguém ABRIU o site (uma por sessão do navegador)
--   booking_click   alguém apertou um botão que leva ao AGENDAMENTO
--   whatsapp_click  alguém apertou o botão de WhatsApp do site
--
-- O terceiro entra junto porque é a OUTRA saída do site: sem ele o funil
-- mentiria por omissão — um site que manda todo mundo para o WhatsApp
-- apareceria como um site que não converte, quando na verdade a conversa
-- continuou no lugar que o próprio painel conta como lead.
CREATE TABLE IF NOT EXISTS public.tb_community_site_event_daily (
  id_profile UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  day        DATE        NOT NULL,
  kind       VARCHAR(16) NOT NULL,
  events     INTEGER     NOT NULL DEFAULT 0 CHECK (events >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_community_site_event_daily PRIMARY KEY (id_profile, day, kind)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_community_site_event_kind'
  ) THEN
    ALTER TABLE public.tb_community_site_event_daily
      ADD CONSTRAINT chk_community_site_event_kind
      CHECK (kind IN ('view', 'booking_click', 'whatsapp_click'));
  END IF;
END $$;

-- A leitura do painel é sempre "esta comunidade, destes últimos N dias" — a PK
-- já serve o prefixo (id_profile, day), então não há índice a mais a criar.

-- ─── Agendamento vindo do site: a busca por ORIGEM ──────────────────────────
-- A mig 227 criou `id_origin_community` com um índice parcial pensado para o
-- caminho do AVISO (achar o líder de UM agendamento). O painel faz a pergunta
-- inversa — "todos os agendamentos DESTA comunidade no período" — e varreria a
-- tabela inteira de agendamentos da plataforma para respondê-la.
CREATE INDEX IF NOT EXISTS ix_bookings_origin_community_created
  ON public.tb_profile_bookings (id_origin_community, created_at DESC)
  WHERE id_origin_community IS NOT NULL;
