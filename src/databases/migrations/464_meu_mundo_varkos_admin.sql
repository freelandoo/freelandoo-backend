-- 464 — Meu Mundo 3D: Varkos, o Leão da Guerra (deus novo, 22/11), entra na cápsula de
-- todo administrador, como os outros deuses entraram pela conversão das skins (mig 340:
-- o admin tinha todas). Vira personagem no próximo withLife (claimGrants entrega mesmo
-- com a cápsula cheia). Idempotente pela referência.
INSERT INTO public.tb_mm_character_grant (id_user, species, sex, source, ref)
SELECT DISTINCT ur.id_user, 'varkos', 'm', 'gift', 'admin:varkos'
  FROM public.tb_user_role ur
  JOIN public.tb_role ro ON ro.id_role = ur.id_role
 WHERE ur.is_active = TRUE AND ro.is_active = TRUE AND ro.desc_role = 'Administrator'
ON CONFLICT (id_user, source, ref) DO NOTHING;
