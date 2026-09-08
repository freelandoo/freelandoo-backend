-- =============================================================================
-- Migration 227: de qual SITE de comunidade veio o agendamento
-- =============================================================================
-- Pedido do Alex (2026-09-08): "quando agendar ali, vá uma mensagem pra caixa de
-- mensagens do perfil líder da comunidade, e também, se tiver conectado o
-- Evolution, com o número de WhatsApp (...) as notificações dos agendamentos
-- precisam ir pra lá".
--
-- ─── POR QUE UMA COLUNA, E NÃO UMA DEDUÇÃO NA HORA DE AVISAR ────────────────
--
-- O agendamento já sabe COM QUEM é (`id_profile`) — o que ele não sabia é POR
-- ONDE a pessoa chegou. E as duas portas existem ao mesmo tempo: o modal do
-- perfil (que não tem comunidade nenhuma por trás) e o site da comunidade
-- (mig 221), onde o líder é o dono do negócio e precisa saber de toda reserva,
-- inclusive das que caem na agenda de um profissional da equipe dele.
--
-- Deduzir isso depois — "ache uma comunidade onde este perfil atende" — daria a
-- resposta errada nos dois sentidos: quem atende em duas comunidades avisaria a
-- errada, e quem agendou pelo modal do perfil faria o líder receber uma reserva
-- que não passou pelo negócio dele. A origem é um FATO do momento do
-- agendamento; ou se guarda ali, ou se adivinha para sempre.
--
-- ─── NULLABLE É O ESTADO NORMAL ─────────────────────────────────────────────
--
-- NULL = "não veio de site nenhum", que é o caso de todo agendamento feito pelo
-- perfil e de todos os que já existem. Não há backfill: não existe registro de
-- onde as reservas antigas nasceram, e chutar uma comunidade para elas
-- inventaria um histórico que ninguém viveu.
--
-- ⚠️ A COLUNA É AFIRMADA PELO CLIENTE, ENTÃO O SERVICE VALIDA. Ela chega no
-- corpo do POST, e sem checagem qualquer pessoa logada poderia carimbar a
-- comunidade de um desconhecido e fazer chegar mensagem na caixa (e no
-- WhatsApp) do líder dele. `BookingService.createPublicBooking` só aceita a
-- origem quando o perfil agendado REALMENTE atende naquela comunidade — é o
-- líder dela ou está em tb_community_professional. Não batendo, a coluna fica
-- NULL e o agendamento segue normalmente: origem duvidosa vira silêncio, nunca
-- recusa do agendamento (o horário marcado é verdadeiro de qualquer forma).
--
-- ─── SET NULL, NÃO CASCADE ──────────────────────────────────────────────────
--
-- A comunidade pode ser apagada; a reserva, não. Ela é dinheiro pago, agenda
-- bloqueada e um compromisso com hora marcada — apagar o agendamento junto com
-- o site que o originou seria perder o compromisso porque o anúncio saiu do ar.
-- =============================================================================

ALTER TABLE public.tb_profile_bookings
  ADD COLUMN IF NOT EXISTS id_origin_community UUID
  REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL;

-- "Quais reservas vieram pelo meu site?" — a pergunta do painel do líder, e o
-- que o aviso usa para achar o dono do site. Parcial porque a esmagadora
-- maioria das linhas é NULL (agendamento pelo perfil).
CREATE INDEX IF NOT EXISTS idx_bookings_origin_community
  ON public.tb_profile_bookings (id_origin_community)
  WHERE id_origin_community IS NOT NULL;
