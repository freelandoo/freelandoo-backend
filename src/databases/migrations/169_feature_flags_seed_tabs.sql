-- =============================================================================
-- Migration 169: mais responsabilidades no Painel de Controle (feature flags)
-- =============================================================================
-- Adiciona as chaves de Serviços, Cursos e Comunidades ao tb_feature_flag
-- (criado na mig 168). Desligar cada uma esconde a aba correspondente na busca
-- (/search) E a aba dentro dos perfis de user/subperfil. Dados preservados.
--
-- Obs.: diferente de 'store', estas três gateiam por enquanto só as superfícies
-- (abas) no frontend — não bloqueiam as rotas do backend, para não derrubar o
-- núcleo da vitrine (serviços são a aba padrão da busca) nem as landings
-- públicas de cursos/comunidades. Idempotente (ON CONFLICT DO NOTHING).
-- =============================================================================

INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES
  (
    'services',
    'Serviços',
    'Aba Serviços na busca e a aba Serviços dentro dos perfis de user/subperfil. Desligar esconde essas abas (dados preservados).'
  ),
  (
    'courses',
    'Cursos',
    'Aba Cursos na busca, a aba Cursos dentro dos perfis e em "Meus Cursos" no Account. Desligar esconde essas abas (dados preservados).'
  ),
  (
    'communities',
    'Comunidades',
    'Aba Comunidades na busca e a aba Comunidade dentro do Account. Desligar esconde essas abas (dados preservados).'
  )
ON CONFLICT (flag_key) DO NOTHING;
