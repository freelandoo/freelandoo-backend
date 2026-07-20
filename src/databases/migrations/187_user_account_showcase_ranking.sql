-- 187: Perfil-conta entra de verdade na vitrine e no ranking
-- (paridade user≡subperfil, decisão Alex 2026-07-19/20).
--
-- A mig 052 criou o trigger fn_user_account_profile_defaults forçando
-- showcase_visible=FALSE e ranking_visible=FALSE em todo perfil-conta
-- (is_user_account=TRUE). As entregas de vitrine (SearchStorage) e ranking
-- (RankingStorage) de 2026-07-19 passaram a ACEITAR o perfil-conta, mas as
-- queries continuam exigindo showcase_visible=TRUE / ranking_visible=TRUE —
-- ou seja, o trigger antigo deixava as duas paridades inertes.
--
-- Esta migration re-declara o trigger (roda DEPOIS da 052 no boot, então a
-- versão daqui vence) com a semântica nova:
--   - showcase_visible := TRUE  (vitrine; o off-switch é a pref "vitrine"
--     em tb_user_feature_pref, não esta coluna)
--   - ranking_visible  := TRUE  (ranking Geral; escopos taxonômicos seguem
--     excluindo o perfil-conta nas queries)
--   - feed_visible     := TRUE  (inalterado)
--   - is_visible       := FALSE (inalterado — os pontos públicos usam o
--     bypass "OR is_user_account", não esta flag)
-- e faz o backfill dos perfis-conta existentes.

CREATE OR REPLACE FUNCTION public.fn_user_account_profile_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_user_account = TRUE THEN
    NEW.showcase_visible := TRUE;
    NEW.ranking_visible  := TRUE;
    NEW.feed_visible     := TRUE;
    NEW.is_visible       := FALSE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- O trigger em si (trg_user_account_profile_defaults) já existe desde a 052 e
-- aponta pra função por nome — basta substituir o corpo acima.

UPDATE public.tb_profile
   SET showcase_visible = TRUE,
       ranking_visible  = TRUE
 WHERE is_user_account = TRUE
   AND (showcase_visible = FALSE OR ranking_visible = FALSE);
