-- 293 — MEU MUNDO 3D: convites e visitas às casas (mm3d-09).
--
-- O titular entra na própria casa sem convite. Qualquer outra pessoa — vizinho
-- do mesmo bairro inclusive — só entra com um convite ACEITO do titular, e só
-- naquela casa. Visitar nunca muda residência, casa ou bairro de ninguém.
--
-- Estados (explícitos, com horário do servidor):
--   pending   -> enviado, esperando resposta (expira em minutos — ver
--               src/utils/meuMundoVisits.js, VISIT_RULES)
--   active    -> aceito: a visita está acontecendo
--   declined  -> o convidado recusou
--   canceled  -> o anfitrião cancelou antes da resposta
--   expired   -> ninguém respondeu a tempo
--   ended     -> a visita terminou (anfitrião encerrou, convidado voltou,
--               desconexão além da tolerância, troca de titular)
--
-- Garantias do BANCO (a última barreira contra corrida):
--   - no máximo UM convite pendente ou visita ativa por anfitrião;
--   - no máximo UMA visita ativa por convidado;
--   - ninguém convida a si mesmo.
-- O resto (o anfitrião não pode estar visitando outra casa, o convidado não
-- pode ser anfitrião de uma visita ativa, proximidade, papel) é conferido no
-- serviço dentro de uma transação com trava.
--
-- ISOLAMENTO: como as outras tb_mm_*, nada aqui toca saldo, Poléns ou
-- patrimônio da Freelandoo.

CREATE TABLE IF NOT EXISTS public.tb_mm_visit (
  id_visit UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_host UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_guest UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_house UUID NOT NULL REFERENCES public.tb_mm_house(id_house) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NULL,
  closed_at TIMESTAMPTZ NULL,
  end_reason TEXT NULL,
  CONSTRAINT chk_mm_visit_status CHECK (status IN ('pending', 'active', 'declined', 'canceled', 'expired', 'ended')),
  CONSTRAINT chk_mm_visit_self CHECK (id_host <> id_guest)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_visit_host_live
  ON public.tb_mm_visit (id_host) WHERE status IN ('pending', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_visit_guest_active
  ON public.tb_mm_visit (id_guest) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_mm_visit_guest_live
  ON public.tb_mm_visit (id_guest) WHERE status IN ('pending', 'active');
