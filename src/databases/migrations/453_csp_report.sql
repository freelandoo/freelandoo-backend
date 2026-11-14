-- 453_csp_report.sql — Segurança A4 (CSP): relatórios de violação da CSP, AGREGADOS.
--
-- A CSP do front está em Report-Only desde a F2 sem `report-uri`: as violações só apareciam no
-- console de quem navegava e nunca foram lidas — e o enforce depende delas. O navegador manda o
-- relatório para POST /csp-report; aqui fica UMA linha por (diretiva, origem bloqueada, caminho da
-- página) com a contagem. Sem dado pessoal: da URL bloqueada só a ORIGEM, da página só o CAMINHO
-- (sem query), nada de IP nem de conta. Teto de linhas no serviço (CspReportService).

CREATE TABLE IF NOT EXISTS public.tb_csp_report (
  id          BIGSERIAL    PRIMARY KEY,
  directive   TEXT         NOT NULL,
  blocked     TEXT         NOT NULL,
  page        TEXT         NOT NULL,
  hits        INTEGER      NOT NULL DEFAULT 1,
  first_seen  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_seen   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_csp_report_key UNIQUE (directive, blocked, page)
);

CREATE INDEX IF NOT EXISTS tb_csp_report_last_seen_idx ON public.tb_csp_report (last_seen DESC);
