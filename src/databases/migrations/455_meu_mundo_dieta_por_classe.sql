-- 455 — MEU MUNDO 3D (VS5, 2026-11-15): cada classe come o seu.
--
-- Pedido do Alex: "bolsa de sangue ao invés de salmão". A regra (src/utils/meuMundoLife.js,
-- VAMPIRE_PAIRS) dá a toda comida da Raposa um PAR do Vampiro com os mesmos números; o
-- Vampiro não come carne e a Raposa não bebe sangue. A Raposa ficou com os ids de antes.
--
-- Aqui: na despensa de quem é Vampiro (tb_mm_clan), cada comida de carne vira o par de
-- sangue (somando ao que já houver, teto 99 = FRIDGE.MAX_STACK). Raposa e quem não tem classe
-- não mudam. Idempotente: na segunda vez não sobra carne na despensa de Vampiro para mover.
-- Nenhuma moeda muda (o par custa o mesmo).

WITH pairs (carne, sangue) AS (
  VALUES
    ('salmao_legumes', 'bolsa_sangue'),
    ('frango_salada', 'sangue_cervo'),
    ('prato_integral', 'caldo_sangue_graos'),
    ('bowl_frutas', 'ameixas_sangue'),
    ('omelete_legumes', 'chourico'),
    ('iogurte_aveia', 'pudim_sangue'),
    ('sopa_legumes', 'sopa_sangue'),
    ('prato_feito', 'prato_madrugada'),
    ('hamburguer', 'torta_sangue'),
    ('pizza', 'pao_sangue'),
    ('cachorro_quente', 'espeto_morcela'),
    ('coxinha', 'bolinho_sangue'),
    ('chocolate', 'bala_sangue'),
    ('miojo', 'caldo_ralo'),
    ('salgadinho', 'lascas_sangue'),
    ('biscoito_recheado', 'biscoito_sangue'),
    ('refrigerante', 'soda_sangue')
),
moved AS (
  DELETE FROM public.tb_mm_pantry p
   USING pairs pr, public.tb_mm_clan c
   WHERE p.item_id = pr.carne
     AND c.id_user = p.id_user
     AND c.clan = 'vampiro'
  RETURNING p.id_user, pr.sangue, p.qty
)
INSERT INTO public.tb_mm_pantry (id_user, item_id, qty)
SELECT id_user, sangue, LEAST(99, SUM(qty))::int
  FROM moved
 WHERE qty > 0
 GROUP BY id_user, sangue
ON CONFLICT (id_user, item_id)
DO UPDATE SET qty = LEAST(99, public.tb_mm_pantry.qty + EXCLUDED.qty), updated_at = NOW();
