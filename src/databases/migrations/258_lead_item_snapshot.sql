-- =============================================================================
-- Migration 258: o lead salvo passa a guardar um SNAPSHOT da empresa.
--
-- ⚠️ POR QUE ISTO EXISTE: o catálogo (`tb_company`) mudou de BANCO. Ele saiu da
-- plataforma para não disputar os 128 MB de `shared_buffers` com `tb_user`,
-- `tb_profile` e o feed — era essa disputa que fazia a requisição do usuário
-- comum ir ao disco e prender as 25 conexões do pool num pico.
--
-- **NÃO EXISTE FK ENTRE BANCOS, e não existe JOIN entre bancos.** A consulta
-- que monta a lista de leads salvos fazia `JOIN tb_company` — e era a ÚNICA do
-- subsistema a atravessar a fronteira. O snapshot é o que a substitui.
--
-- ⚠️ E ELE NÃO É REMENDO — é correção de um defeito que já existia. Hoje o lead
-- salvo MUDA SOB OS PÉS DO VENDEDOR: cada reabastecimento reescreve
-- `tb_company`, então o telefone que ele salvou na terça pode ser outro na
-- quinta, sem aviso. Com o snapshot, o que foi salvo é o que ele vê.
--
-- ⚠️ JSONB E NÃO 40 COLUNAS: são 46 campos em `COMPANY_COLUMNS`, e copiá-los um
-- a um obrigaria esta tabela a acompanhar toda coluna nova de `tb_company` —
-- a que ficasse para trás sumiria da tela do vendedor sem erro nenhum.
--
-- O backfill ABAIXO só é possível porque esta migration roda no banco QUENTE
-- enquanto `tb_company` ainda existe nele. Depois da virada, snapshot NULL
-- vira lead sem dados na tela — e é por isso que ele é feito aqui, e não
-- depois.
-- =============================================================================

ALTER TABLE public.tb_lead_list_item
  ADD COLUMN IF NOT EXISTS company_snapshot JSONB NULL;

-- ⚠️ Quando o lead foi fotografado. Serve para a tela poder dizer "dado de
-- 24/09" em vez de deixar o vendedor achar que é de agora — e para um dia
-- reatualizar os antigos sem adivinhar quais já estão velhos.
ALTER TABLE public.tb_lead_list_item
  ADD COLUMN IF NOT EXISTS snapshot_at TIMESTAMPTZ NULL;

-- ⚠️ SUPRESSÃO (LGPD) SEM JOIN. Antes, a lista filtrava `c.suppressed_at IS
-- NULL` no JOIN com `tb_company`. Sem o JOIN, quem pediu para sair continuaria
-- aparecendo na lista de quem já o tinha salvo — exatamente o que o opt-out
-- existe para impedir. Agora a supressão é ESCRITA aqui (fan-out no momento do
-- pedido, que é raro), e a leitura só filtra esta coluna.
ALTER TABLE public.tb_lead_list_item
  ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ix_lead_list_item_suppressed
  ON public.tb_lead_list_item (id_company)
  WHERE suppressed_at IS NULL;

-- ⚠️ A FK PARA `tb_company` SAI — e esta é a linha que torna a virada possível.
-- Com `DATABASE_URL_COLD` definida, empresa nova só nasce no banco FRIO; a FK
-- faria todo `addCompany` falhar por violação (a empresa não existe no quente),
-- e o `ON DELETE CASCADE` apagaria as listas de todo mundo no dia em que o
-- `tb_company` antigo do quente fosse esvaziado. Varre o catálogo pela COLUNA,
-- não pelo nome (lição da mig 189): nome gerado pelo Postgres não é contrato.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.tb_lead_list_item'::regclass
       AND con.contype = 'f'
       AND att.attname = 'id_company'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_lead_list_item DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- Backfill: fotografa os leads já salvos com o que o catálogo do quente diz
-- AGORA. Idempotente (só onde ainda é NULL) e inofensivo num banco sem
-- `tb_company` (banco novo, ou depois de o catálogo sair daqui).
DO $$
BEGIN
  IF to_regclass('public.tb_company') IS NOT NULL THEN
    UPDATE public.tb_lead_list_item i
       SET company_snapshot = to_jsonb(c.*),
           snapshot_at      = NOW(),
           suppressed_at    = COALESCE(i.suppressed_at, c.suppressed_at)
      FROM public.tb_company c
     WHERE c.id_company = i.id_company
       AND i.company_snapshot IS NULL;
  END IF;
END $$;
