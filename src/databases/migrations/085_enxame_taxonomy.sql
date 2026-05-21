-- Migration 085: Nova taxonomia "Enxame" (substitui as 8 "Máquinas")
-- =============================================================================
-- O conceito "Máquina" da vitrine foi renomeado para "Enxame" na aplicação.
-- A tabela física segue chamando-se tb_machine (e a coluna id_machine): o runner
-- re-executa TODAS as migrations a cada deploy, então renomear a tabela exigiria
-- editar migrations históricas (003/021/023/058/061) — risco desnecessário.
-- O rename acontece 100% na camada de aplicação.
--
-- Substituição total da taxonomia: 15 enxames + ~300 profissões.
-- As 8 máquinas antigas e as categorias antigas são DESATIVADAS (não apagadas):
-- FKs RESTRICT/NOT NULL de clans, service_requests e supervisão impedem o DELETE
-- físico. Desativadas, somem de toda a UI; perfis em profissões removidas mantêm
-- a FK válida e precisam reescolher.
--
-- Idempotente: seguro re-executar (upsert por slug, keep-first por nome).
-- =============================================================================

-- 1. Desativar a taxonomia antiga --------------------------------------------
UPDATE public.tb_machine
   SET is_active = FALSE, updated_at = NOW()
 WHERE slug NOT IN (
   'marketing','tecnologia','transporte','artistas','justica','influencer',
   'servicos_residenciais','construcao','saude','beleza_bem_estar','veiculos',
   'pets','rural','educacao','eventos'
 );

UPDATE public.tb_category
   SET is_active = FALSE, id_machine = NULL, updated_at = NOW();

-- 2. Semear os 15 enxames (upsert por slug → ids estáveis entre re-execuções) -
INSERT INTO public.tb_machine
  (slug, name, display_order, color_from, color_to, color_glow, color_ring,
   color_accent, color_text, description, icon_name, is_active)
VALUES
  ('marketing', 'Enxame de Marketing', 1,
   '#e11d48', '#f43f5e', 'rgba(244,63,94,0.45)', 'rgba(244,63,94,0.7)',
   '#fb7185', '#fecdd3',
   'Estratégia, conteúdo, design e gestão para marcas crescerem e venderem mais.',
   'Megaphone', TRUE),
  ('tecnologia', 'Enxame de Tecnologia', 2,
   '#2563eb', '#3b82f6', 'rgba(59,130,246,0.45)', 'rgba(59,130,246,0.7)',
   '#60a5fa', '#bfdbfe',
   'Desenvolvimento, dados, infraestrutura e IA para construir produtos digitais.',
   'Code', TRUE),
  ('transporte', 'Enxame de Transporte', 3,
   '#d97706', '#f59e0b', 'rgba(245,158,11,0.45)', 'rgba(245,158,11,0.7)',
   '#fbbf24', '#fde68a',
   'Motoristas, entregas, logística e mudanças para mover pessoas e cargas.',
   'Truck', TRUE),
  ('artistas', 'Enxame de Artistas', 4,
   '#7c3aed', '#a855f7', 'rgba(168,85,247,0.45)', 'rgba(168,85,247,0.7)',
   '#c084fc', '#e9d5ff',
   'Música, atuação, ilustração e palco para quem vive de criar e performar.',
   'Palette', TRUE),
  ('justica', 'Enxame de Justiça', 5,
   '#4338ca', '#6366f1', 'rgba(99,102,241,0.45)', 'rgba(99,102,241,0.7)',
   '#818cf8', '#c7d2fe',
   'Direito, política, fiscalização e atuação pública para causas e instituições.',
   'Scale', TRUE),
  ('influencer', 'Enxame de Influencer', 6,
   '#db2777', '#ec4899', 'rgba(236,72,153,0.45)', 'rgba(236,72,153,0.7)',
   '#f472b6', '#fbcfe8',
   'Creators de todos os nichos que produzem conteúdo e engajam audiências.',
   'Sparkles', TRUE),
  ('servicos_residenciais', 'Enxame de Serviços Residenciais', 7,
   '#059669', '#10b981', 'rgba(16,185,129,0.45)', 'rgba(16,185,129,0.7)',
   '#34d399', '#a7f3d0',
   'Limpeza, cuidados, manutenção e apoio para o dia a dia da casa.',
   'House', TRUE),
  ('construcao', 'Enxame de Construção', 8,
   '#ea580c', '#f97316', 'rgba(249,115,22,0.45)', 'rgba(249,115,22,0.7)',
   '#fb923c', '#fed7aa',
   'Obra, reforma, instalações e acabamento — do alicerce à entrega.',
   'HardHat', TRUE),
  ('saude', 'Enxame de Saúde', 9,
   '#0d9488', '#06b6d4', 'rgba(6,182,212,0.45)', 'rgba(6,182,212,0.7)',
   '#22d3ee', '#a5f3fc',
   'Profissionais de saúde, terapias e cuidados para o corpo e a mente.',
   'HeartPulse', TRUE),
  ('beleza_bem_estar', 'Enxame de Beleza e Bem-estar', 10,
   '#c026d3', '#d946ef', 'rgba(217,70,239,0.45)', 'rgba(217,70,239,0.7)',
   '#e879f9', '#f5d0fe',
   'Cabelo, estética, terapias e autocuidado para se sentir bem.',
   'Flower2', TRUE),
  ('veiculos', 'Enxame de Veículos', 11,
   '#dc2626', '#ef4444', 'rgba(239,68,68,0.45)', 'rgba(239,68,68,0.7)',
   '#f87171', '#fecaca',
   'Mecânica, estética automotiva, reparos e serviços para todo tipo de veículo.',
   'Car', TRUE),
  ('pets', 'Enxame de Pets', 12,
   '#16a34a', '#22c55e', 'rgba(34,197,94,0.45)', 'rgba(34,197,94,0.7)',
   '#4ade80', '#bbf7d0',
   'Veterinária, banho e tosa, adestramento e cuidados para animais.',
   'PawPrint', TRUE),
  ('rural', 'Enxame Rural', 13,
   '#65a30d', '#84cc16', 'rgba(132,204,22,0.45)', 'rgba(132,204,22,0.7)',
   '#a3e635', '#d9f99d',
   'Agropecuária, máquinas, manejo e gestão para o campo.',
   'Wheat', TRUE),
  ('educacao', 'Enxame de Educação', 14,
   '#0284c7', '#0ea5e9', 'rgba(14,165,233,0.45)', 'rgba(14,165,233,0.7)',
   '#38bdf8', '#bae6fd',
   'Ensino, mentoria, treinamento e desenvolvimento de pessoas.',
   'GraduationCap', TRUE),
  ('eventos', 'Enxame de Eventos', 15,
   '#ca8a04', '#eab308', 'rgba(234,179,8,0.45)', 'rgba(234,179,8,0.7)',
   '#facc15', '#fef08a',
   'Produção, gastronomia, animação e estrutura para festas e eventos.',
   'PartyPopper', TRUE)
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  display_order = EXCLUDED.display_order,
  color_from    = EXCLUDED.color_from,
  color_to      = EXCLUDED.color_to,
  color_glow    = EXCLUDED.color_glow,
  color_ring    = EXCLUDED.color_ring,
  color_accent  = EXCLUDED.color_accent,
  color_text    = EXCLUDED.color_text,
  description   = EXCLUDED.description,
  icon_name     = EXCLUDED.icon_name,
  is_active     = TRUE,
  updated_at    = NOW();

-- 3. Semear as profissões -----------------------------------------------------
-- Keep-first: quando um nome aparece em mais de um enxame, vence a 1ª ocorrência.
-- Reaproveita categorias antigas por nome (lower) — perfis nesses nomes não
-- ficam órfãos. Profissões removidas permanecem is_active = FALSE.
-- unaccent é necessário pra gerar profession_slug (já habilitado pela mig 011,
-- mantemos por idempotência caso 085 rode antes em algum cenário).
CREATE EXTENSION IF NOT EXISTS unaccent;

DO $seed$
DECLARE
  v          RECORD;
  v_enx      INTEGER;
  v_cat      RECORD;
  v_slug_base TEXT;
  v_slug     TEXT;
  v_suffix   INT;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      -- 1. Marketing
      ('marketing','Estrategista de Marketing e Gestão'),
      ('marketing','Social Media'),
      ('marketing','Copywriter'),
      ('marketing','Designer Gráfico'),
      ('marketing','Editor de Vídeo'),
      ('marketing','Videomaker'),
      ('marketing','Fotógrafo'),
      ('marketing','Web Designer'),
      ('marketing','Atendimento ao Cliente'),
      ('marketing','Criador de Conteúdo'),
      ('marketing','Contador'),
      ('marketing','Gestor'),
      ('marketing','Administrador'),
      -- 2. Tecnologia
      ('tecnologia','Desenvolvedor/Programador'),
      ('tecnologia','Engenheiro de Software'),
      ('tecnologia','Analista de Sistemas'),
      ('tecnologia','QA / Tester'),
      ('tecnologia','DevOps'),
      ('tecnologia','DBA'),
      ('tecnologia','Engenheiro de Dados'),
      ('tecnologia','Especialista em IA'),
      ('tecnologia','Suporte Técnico'),
      ('tecnologia','Web Designer'),
      ('tecnologia','Gerente de Projetos'),
      ('tecnologia','Engenheiro de Infraestrutura'),
      ('tecnologia','Cybersegurança'),
      -- 3. Transporte
      ('transporte','Motorista de Aplicativo'),
      ('transporte','Motorista Particular'),
      ('transporte','Motoboy'),
      ('transporte','Entregador de Aplicativo'),
      ('transporte','Caminhoneiro'),
      ('transporte','Gerente de Logística'),
      ('transporte','Operador de Logística'),
      ('transporte','Operador de Empilhadeira'),
      ('transporte','Expedidor'),
      ('transporte','Transportadora de Mudanças'),
      ('transporte','Ajudante de Mudança'),
      ('transporte','Montador de Móveis para Mudança'),
      ('transporte','Transporte Escolar'),
      ('transporte','Entregador de Bicicleta'),
      ('transporte','Refrigerado'),
      -- 4. Artistas
      ('artistas','Cantor'),
      ('artistas','Instrumentista'),
      ('artistas','Compositor'),
      ('artistas','Produtor Musical'),
      ('artistas','DJ'),
      ('artistas','Ator/Atriz'),
      ('artistas','Dublador'),
      ('artistas','Roteirista'),
      ('artistas','Comediante'),
      ('artistas','Apresentador'),
      ('artistas','Dançarino'),
      ('artistas','Modelo Fotográfico'),
      ('artistas','Ilustrador'),
      ('artistas','Tatuador'),
      ('artistas','Artista Digital'),
      ('artistas','Artista Plástico'),
      ('artistas','Artista de Rua'),
      ('artistas','Artista Circense'),
      ('artistas','Figurinista'),
      ('artistas','Professor de Artes'),
      ('artistas','Estilista'),
      -- 5. Justiça
      ('justica','Político de Carreira'),
      ('justica','Presidente da República'),
      ('justica','Secretário'),
      ('justica','Assessor'),
      ('justica','Cientista Político'),
      ('justica','Marqueteiro Político'),
      ('justica','Servidor Público'),
      ('justica','Advogado'),
      ('justica','Juiz'),
      ('justica','Delegado'),
      ('justica','Fiscal'),
      ('justica','Jornalista'),
      ('justica','Ativista'),
      ('justica','Sindicalista'),
      ('justica','Militante Político'),
      ('justica','Conselheiro'),
      ('justica','Relações Institucionais'),
      -- 6. Influencer
      ('influencer','Streamer'),
      ('influencer','YouTuber'),
      ('influencer','Tiktoker'),
      ('influencer','Instagrammer'),
      ('influencer','Podcaster'),
      ('influencer','Gamer'),
      ('influencer','Fitness'),
      ('influencer','Moda/Beleza'),
      ('influencer','Tecnologia'),
      ('influencer','Viagem'),
      ('influencer','Gastronômico'),
      ('influencer','Automotivo'),
      ('influencer','Geek'),
      ('influencer','Stand-up'),
      ('influencer','Educacional'),
      ('influencer','Negócios'),
      ('influencer','Financeiro'),
      ('influencer','Coach'),
      ('influencer','Música'),
      ('influencer','Dança'),
      ('influencer','Cinema/Séries'),
      ('influencer','Futebol'),
      ('influencer','Esportes'),
      ('influencer','Pet'),
      ('influencer','Biólogo'),
      ('influencer','Afiliado Digital'),
      ('influencer','Luxo'),
      ('influencer','Conteúdo Adulto'),
      ('influencer','Relacionamento'),
      ('influencer','Maternidade'),
      ('influencer','Saúde'),
      ('influencer','Decoração'),
      ('influencer','Cosplayer'),
      -- 7. Serviços Residenciais
      ('servicos_residenciais','Diarista'),
      ('servicos_residenciais','Cozinheira'),
      ('servicos_residenciais','Governanta'),
      ('servicos_residenciais','Cuidador de Idosos'),
      ('servicos_residenciais','Babá'),
      ('servicos_residenciais','Dog Walker'),
      ('servicos_residenciais','Pet Sitter'),
      ('servicos_residenciais','Jardineiro'),
      ('servicos_residenciais','Piscineiro'),
      ('servicos_residenciais','Caseiro'),
      ('servicos_residenciais','Zelador'),
      ('servicos_residenciais','Marido de Aluguel'),
      ('servicos_residenciais','Montador de Móveis'),
      ('servicos_residenciais','Chaveiro'),
      ('servicos_residenciais','Vidraceiro'),
      ('servicos_residenciais','Dedetizador'),
      ('servicos_residenciais','Técnico de Ar-Condicionado'),
      ('servicos_residenciais','Técnico em Eletrodomésticos'),
      ('servicos_residenciais','Segurança'),
      ('servicos_residenciais','Limpeza de Estofados'),
      -- 8. Construção
      ('construcao','Pedreiro'),
      ('construcao','Servente de Pedreiro'),
      ('construcao','Mestre de Obras'),
      ('construcao','Engenheiro Civil'),
      ('construcao','Arquiteto'),
      ('construcao','Marceneiro'),
      ('construcao','Serralheiro'),
      ('construcao','Soldador'),
      ('construcao','Eletricista'),
      ('construcao','Encanador'),
      ('construcao','Pintor'),
      ('construcao','Gesseiro'),
      ('construcao','Azulejista'),
      ('construcao','Marmorista'),
      ('construcao','Vidraceiro'),
      ('construcao','Telhadista'),
      ('construcao','Operador de Máquinas Pesadas'),
      ('construcao','Topógrafo'),
      ('construcao','Técnico em Segurança'),
      ('construcao','Designer de Interiores'),
      ('construcao','Técnico em Energia Solar'),
      ('construcao','Técnico em Refrigeração'),
      ('construcao','Técnico de Elevadores'),
      ('construcao','Demolidor'),
      ('construcao','Técnico em Saneamento'),
      ('construcao','Corretor de Imóveis'),
      ('construcao','Limpeza Pesada'),
      ('construcao','Construtor'),
      -- 9. Saúde
      ('saude','Médico'),
      ('saude','Enfermeiro'),
      ('saude','Psiquiatra'),
      ('saude','Psicólogo'),
      ('saude','Fisioterapeuta'),
      ('saude','Fonoaudiólogo'),
      ('saude','Nutricionista'),
      ('saude','Dentista'),
      ('saude','Biomédico'),
      ('saude','Farmacêutico'),
      ('saude','Radiologista'),
      ('saude','Biólogo'),
      ('saude','Personal Trainer'),
      ('saude','Massoterapeuta'),
      ('saude','Quiropraxista'),
      ('saude','Acupunturista'),
      ('saude','Cuidador de Idosos'),
      ('saude','Paramédico'),
      ('saude','Condutor de Ambulância'),
      ('saude','Médico do Trabalho'),
      ('saude','Perito Médico'),
      ('saude','Auditor em Saúde'),
      ('saude','Podólogo'),
      ('saude','Esteticista'),
      ('saude','Doula'),
      ('saude','Cuidador Infantil'),
      ('saude','Protético'),
      -- 10. Beleza e Bem-estar
      ('beleza_bem_estar','Cabeleireiro'),
      ('beleza_bem_estar','Barbeiro'),
      ('beleza_bem_estar','Trancista'),
      ('beleza_bem_estar','Maquiador'),
      ('beleza_bem_estar','Nail Designer'),
      ('beleza_bem_estar','Manicure'),
      ('beleza_bem_estar','Lash Designer'),
      ('beleza_bem_estar','Micropigmentador'),
      ('beleza_bem_estar','Esteticista'),
      ('beleza_bem_estar','Massagista'),
      ('beleza_bem_estar','Acupunturista'),
      ('beleza_bem_estar','Terapeuta'),
      ('beleza_bem_estar','Spa'),
      ('beleza_bem_estar','Emagrecimento'),
      ('beleza_bem_estar','Personal Trainer'),
      ('beleza_bem_estar','Instrutor de Yoga'),
      ('beleza_bem_estar','Instrutor de Pilates'),
      ('beleza_bem_estar','Nutricionista'),
      ('beleza_bem_estar','Tatuador'),
      ('beleza_bem_estar','Body Piercer'),
      ('beleza_bem_estar','Harmonização Facial'),
      ('beleza_bem_estar','Dentista'),
      ('beleza_bem_estar','Cirurgião Plástico'),
      ('beleza_bem_estar','Recepcionista'),
      ('beleza_bem_estar','Revendedor de Cosméticos'),
      ('beleza_bem_estar','Depilador'),
      -- 11. Veículos
      ('veiculos','Mecânico Automotivo'),
      ('veiculos','Mecânico de Moto'),
      ('veiculos','Mecânico de Caminhão'),
      ('veiculos','Eletricista Automotivo'),
      ('veiculos','Funileiro'),
      ('veiculos','Martelinho de Ouro'),
      ('veiculos','Detailer Automotivo'),
      ('veiculos','Envelopador Automotivo'),
      ('veiculos','Insulfilm'),
      ('veiculos','Instalador de Acessórios'),
      ('veiculos','Balanceamento e Alinhamento'),
      ('veiculos','Borracheiro'),
      ('veiculos','Chaveiro Automotivo'),
      ('veiculos','Guincheiro'),
      ('veiculos','Vistoriador Veicular'),
      ('veiculos','Consultor Automotivo'),
      ('veiculos','Despachante Veicular'),
      ('veiculos','Corretor de Seguros Automotivos'),
      ('veiculos','Tapeceiro Automotivo'),
      ('veiculos','Mecânico Náutico'),
      ('veiculos','Mecânico de Máquinas Agrícolas'),
      ('veiculos','Instrutor de Direção'),
      ('veiculos','Especialista em Carros Elétricos'),
      ('veiculos','Consultor de Blindagem'),
      -- 12. Pets
      ('pets','Veterinário'),
      ('pets','Auxiliar Veterinário'),
      ('pets','Tosador'),
      ('pets','Dog Walker'),
      ('pets','Pet Sitter'),
      ('pets','Adestrador de Cães'),
      ('pets','Especialista em Animais Exóticos'),
      ('pets','Aquarista'),
      ('pets','Criador de Pets'),
      ('pets','Modelo Pet'),
      ('pets','Vendedor Pet'),
      ('pets','Designer de Roupas Pet'),
      ('pets','Artesão Pet'),
      ('pets','Táxi Pet'),
      ('pets','Biólogo Animal'),
      ('pets','Especialista em Reprodução Animal'),
      ('pets','Tratador Equino'),
      -- 13. Rural
      ('rural','Produtor Rural'),
      ('rural','Pecuarista'),
      ('rural','Engenheiro Agrônomo'),
      ('rural','Veterinário Rural'),
      ('rural','Zootecnista'),
      ('rural','Biólogo Rural'),
      ('rural','Consultor Agropecuário'),
      ('rural','Administrador Rural'),
      ('rural','Operador de Máquinas Agrícolas'),
      ('rural','Colhedor Rural'),
      ('rural','Aplicador de Defensivos Agrícolas'),
      ('rural','Piloto de Drone Agrícola'),
      ('rural','Floricultor'),
      ('rural','Apicultor'),
      ('rural','Ordenhador'),
      ('rural','Inseminador Animal'),
      ('rural','Ferrador'),
      ('rural','Nutricionista Animal'),
      ('rural','Engenheiro Florestal'),
      ('rural','Técnico em Meio Ambiente'),
      ('rural','Vendedor de Insumos Agrícolas'),
      ('rural','Especialista em Agricultura Orgânica'),
      -- 14. Educação
      ('educacao','Professor'),
      ('educacao','Diretor Escolar'),
      ('educacao','Orientador Educacional'),
      ('educacao','Psicopedagogo'),
      ('educacao','Professor Universitário'),
      ('educacao','Pesquisador Acadêmico'),
      ('educacao','Mentor'),
      ('educacao','Coach'),
      ('educacao','Palestrante'),
      ('educacao','Treinador Corporativo'),
      ('educacao','Revisor Acadêmico'),
      ('educacao','Professor de Educação Física'),
      ('educacao','Treinador Esportivo'),
      ('educacao','Catequista'),
      ('educacao','Professor de Educação Especial'),
      ('educacao','Aplicador de Treinamentos Corporativos'),
      -- 15. Eventos
      ('eventos','Produtor de Eventos'),
      ('eventos','Cerimonialista'),
      ('eventos','Promoter'),
      ('eventos','Recepcionista de Eventos'),
      ('eventos','Locutor'),
      ('eventos','DJ'),
      ('eventos','Cantor'),
      ('eventos','Músico para Eventos'),
      ('eventos','Animador de Festas'),
      ('eventos','Mágico'),
      ('eventos','Bartender'),
      ('eventos','Garçom'),
      ('eventos','Chef para Eventos'),
      ('eventos','Churrasqueiro'),
      ('eventos','Cake Designer'),
      ('eventos','Florista'),
      ('eventos','Fotógrafo de Eventos'),
      ('eventos','Videomaker de Eventos'),
      ('eventos','Bombeiro Civil'),
      ('eventos','Valet'),
      ('eventos','Motorista Executivo'),
      ('eventos','Limpeza Pós-Evento'),
      ('eventos','Staff de Eventos'),
      ('eventos','Organizador'),
      ('eventos','Locador de Equipamentos para Eventos')
    ) AS t(enx_slug, profession)
  LOOP
    SELECT id_machine INTO v_enx
      FROM public.tb_machine
     WHERE slug = v.enx_slug;

    IF v_enx IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id_category, id_machine
      INTO v_cat
      FROM public.tb_category
     WHERE LOWER(desc_category) = LOWER(v.profession)
     LIMIT 1;

    IF v_cat.id_category IS NULL THEN
      -- profissão nova → gera profession_slug (NOT NULL, UNIQUE lower) via
      -- mesmo algoritmo da mig 011: unaccent → lower → não-alfanum vira "-"
      -- → colapsa hifens → trim → resolve colisão com sufixo numérico.
      v_slug_base := lower(unaccent(v.profession));
      v_slug_base := regexp_replace(v_slug_base, '[^a-z0-9]+', '-', 'g');
      v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
      v_slug_base := regexp_replace(v_slug_base, '^-|-$', '', 'g');
      IF v_slug_base IS NULL OR length(v_slug_base) = 0 THEN
        v_slug_base := 'profissao';
      END IF;
      v_slug_base := substring(v_slug_base, 1, 75);

      v_slug := v_slug_base;
      v_suffix := 2;
      WHILE EXISTS (
        SELECT 1 FROM public.tb_category WHERE lower(profession_slug) = v_slug
      ) LOOP
        v_slug := v_slug_base || '-' || v_suffix::text;
        v_suffix := v_suffix + 1;
      END LOOP;

      INSERT INTO public.tb_category (desc_category, id_machine, is_active, profession_slug)
      VALUES (v.profession, v_enx, TRUE, v_slug);
    ELSIF v_cat.id_machine IS NULL THEN
      -- categoria reaproveitada por nome (ainda não reivindicada nesta execução)
      UPDATE public.tb_category
         SET id_machine = v_enx,
             is_active  = TRUE,
             updated_at = NOW()
       WHERE id_category = v_cat.id_category;
    END IF;
    -- se id_machine já está setado: nome já reivindicado por um enxame anterior
    -- (keep-first) → ignora a ocorrência duplicada.
  END LOOP;
END
$seed$;
