-- 260_user_quick_pills.sql
-- O ACESSO RÁPIDO DO PERFIL: quais pills ficam atrás da foto.
--
-- Pedido do Alex (2026-09-24): "uma maneira de gerenciar pills, e você pode
-- escolher quais ficam no acesso rápido do perfil". A pilha atrás da foto era
-- fixa (Business, Carteira, Fitness, Games); agora a pessoa escolhe entre
-- esses e os espaços do menu da foto (pet, carro, condomínio, bairro, filhos).
--
-- NULL = "nunca escolheu" → o front mostra a pilha padrão de antes. Lista
-- vazia é escolha ("nenhum pill"), e por isso NÃO é a mesma coisa que NULL.
-- As chaves e o teto (4, que é o que cabe atrás da foto) são validados em
-- `utils/quickPills.js`, não aqui: a lista muda quando nasce espaço novo, e um
-- CHECK exigiria migration a cada um.
ALTER TABLE public.tb_user
  ADD COLUMN IF NOT EXISTS quick_pills TEXT[] NULL;
