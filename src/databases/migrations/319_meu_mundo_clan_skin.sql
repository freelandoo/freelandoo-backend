-- 319 — Meu Mundo 3D mm3d-58: quem escolheu a classe antes desta correção
-- continuou vestido com a skin comprada (a skin passava por cima da classe) e
-- não viu o personagem escolhido. Escolher a classe agora veste o padrão (=
-- personagem da classe); aqui o mesmo para quem já tinha escolhido. As skins
-- compradas continuam no vestuário. Idempotente.

UPDATE public.tb_mm_avatar_pref p
   SET skin = 'standard', updated_at = NOW()
 WHERE p.id_user IN (SELECT id_user FROM public.tb_mm_clan)
   AND p.skin IS DISTINCT FROM 'standard';
