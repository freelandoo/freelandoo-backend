-- =============================================================================
-- Migration 121: Regiões agregadas (Estado → Região → Cidade)
-- =============================================================================
-- A vitrine do enxame passa a filtrar por REGIÃO (não cidade). O usuário ainda
-- cadastra a CIDADE; o backend resolve a região via tb_region_city. A busca por
-- região renderiza todos os perfis cujas cidades pertencem àquela região.
--
-- - fl_norm_city: normaliza nome de cidade (lower + remove acento PT + trim)
--   pra casar "São Paulo" == "sao paulo" sem depender da extensão unaccent.
-- - tb_region: regiões por UF (nome = texto antes do ":" no mapeamento do app).
-- - tb_region_city: cidade(normalizada) → região (1 cidade = 1 região por UF).
-- - tb_profile.id_region: região resolvida do perfil (backfill + write-time).
-- Cidades fora do seed ficam sem região (mapear o resto depois).
-- =============================================================================

CREATE OR REPLACE FUNCTION fl_norm_city(t TEXT) RETURNS TEXT AS $$
  SELECT trim(lower(translate(coalesce(t, ''),
    'áàâãäçéèêëíìîïóòôõöúùûüýñÁÀÂÃÄÇÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÝÑ',
    'aaaaaceeeeiiiiooooouuuuynAAAAACEEEEIIIIOOOOOUUUUYN')));
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS public.tb_region (
  id_region   SERIAL       PRIMARY KEY,
  uf          VARCHAR(2)   NOT NULL,
  name        VARCHAR(160) NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (uf, name)
);

CREATE INDEX IF NOT EXISTS ix_tb_region_uf ON public.tb_region (uf, sort_order);

CREATE TABLE IF NOT EXISTS public.tb_region_city (
  id_region      INT          NOT NULL REFERENCES public.tb_region(id_region) ON DELETE CASCADE,
  uf             VARCHAR(2)   NOT NULL,
  municipio_norm VARCHAR(160) NOT NULL,
  PRIMARY KEY (uf, municipio_norm)
);

CREATE INDEX IF NOT EXISTS ix_tb_region_city_region ON public.tb_region_city (id_region);

ALTER TABLE public.tb_profile
  ADD COLUMN IF NOT EXISTS id_region INT REFERENCES public.tb_region(id_region);

CREATE INDEX IF NOT EXISTS ix_tb_profile_region ON public.tb_profile (id_region);

-- ─── Seed das regiões ────────────────────────────────────────────────────────
INSERT INTO public.tb_region (uf, name, sort_order) VALUES
-- NORTE
('AC','Rio Branco e Baixo Acre',1),('AC','Alto Acre',2),('AC','Vale do Juruá e Interior',3),
('AM','Manaus e Região Metropolitana',1),('AM','Alto Solimões e Juruá',2),('AM','Interior do Amazonas',3),
('AP','Macapá e Região Metropolitana',1),('AP','Norte do Amapá',2),('AP','Sul do Amapá / Jari',3),
('PA','Belém e Região Metropolitana',1),('PA','Nordeste e Litoral Paraense',2),('PA','Marajó e Baixo Amazonas',3),('PA','Carajás e Sudeste Paraense',4),('PA','Xingu e Tapajós',5),
('RO','Porto Velho e Madeira-Mamoré',1),('RO','Centro de Rondônia',2),('RO','Sul de Rondônia',3),
('RR','Boa Vista e Entorno',1),('RR','Norte e Fronteira',2),('RR','Sul de Roraima',3),
('TO','Palmas e Região Central',1),('TO','Norte do Tocantins / Bico do Papagaio',2),('TO','Sul e Sudeste do Tocantins',3),
-- NORDESTE
('AL','Maceió e Região Metropolitana',1),('AL','Litoral e Zona da Mata',2),('AL','Agreste e Sertão',3),
('BA','Salvador, RMS e Recôncavo',1),('BA','Litoral Sul e Extremo Sul',2),('BA','Feira de Santana e Centro-Norte',3),('BA','Chapada e Oeste Baiano',4),('BA','Sudoeste e Sertão Baiano',5),
('CE','Fortaleza e Região Metropolitana',1),('CE','Litoral e Norte Cearense',2),('CE','Sertão Central e Inhamuns',3),('CE','Cariri e Sul Cearense',4),
('MA','São Luís e Ilha',1),('MA','Litoral, Lençóis e Baixada',2),('MA','Centro e Cocais',3),('MA','Sul Maranhense',4),
('PB','João Pessoa e Litoral',1),('PB','Campina Grande e Agreste',2),('PB','Sertão, Cariri e Alto Sertão',3),
('PE','Recife e Região Metropolitana',1),('PE','Zona da Mata e Litoral',2),('PE','Agreste Pernambucano',3),('PE','Sertão e São Francisco',4),
('PI','Teresina e Norte do Piauí',1),('PI','Centro e Médio Parnaíba',2),('PI','Sul do Piauí',3),
('RN','Natal e Litoral Leste',1),('RN','Mossoró e Oeste Potiguar',2),('RN','Seridó e Agreste',3),
('SE','Aracaju e Grande Aracaju',1),('SE','Litoral, Sul e Zona da Mata',2),('SE','Agreste e Sertão Sergipano',3),
-- SUDESTE
('ES','Grande Vitória',1),('ES','Norte Capixaba',2),('ES','Sul, Serrana e Caparaó',3),
('MG','Belo Horizonte e Região Metropolitana',1),('MG','Zona da Mata e Campo das Vertentes',2),('MG','Sul de Minas e Mantiqueira',3),('MG','Triângulo e Alto Paranaíba',4),('MG','Centro-Oeste e Noroeste Mineiro',5),('MG','Norte, Leste e Vales Mineiros',6),
('RJ','Capital e Grande Rio',1),('RJ','Região dos Lagos e Norte Fluminense',2),('RJ','Serrana e Centro-Sul',3),('RJ','Costa Verde e Médio Paraíba',4),
('SP','Capital e Grande São Paulo',1),('SP','Litoral e Vale do Paraíba',2),('SP','Campinas e Interior Central',3),('SP','Sorocaba e Sudoeste',4),('SP','Norte Paulista',5),('SP','Oeste Paulista',6),
-- SUL
('PR','Curitiba e Região Metropolitana',1),('PR','Litoral e Campos Gerais',2),('PR','Norte e Noroeste Paranaense',3),('PR','Oeste e Sudoeste Paranaense',4),
('RS','Porto Alegre e Região Metropolitana',1),('RS','Serra Gaúcha e Hortênsias',2),('RS','Litoral e Sul Gaúcho',3),('RS','Centro e Vales',4),('RS','Norte, Missões e Fronteira',5),
('SC','Grande Florianópolis e Litoral Sul',1),('SC','Vale do Itajaí e Norte Catarinense',2),('SC','Oeste Catarinense',3),('SC','Serra e Planalto Catarinense',4),
-- CENTRO-OESTE
('DF','Distrito Federal',1),
('GO','Goiânia, Anápolis e Região Metropolitana',1),('GO','Entorno do DF e Nordeste Goiano',2),('GO','Sul e Sudoeste Goiano',3),('GO','Norte e Oeste Goiano',4),
('MS','Campo Grande e Região Central',1),('MS','Dourados e Sul/Fronteira',2),('MS','Pantanal, Norte e Bolsão',3),
('MT','Cuiabá e Região Metropolitana',1),('MT','Norte Mato-grossense',2),('MT','Sul e Sudeste Mato-grossense',3),('MT','Oeste e Pantanal Mato-grossense',4)
ON CONFLICT (uf, name) DO NOTHING;

-- ─── Seed das cidades (cidade → região, via join por uf+name) ─────────────────
INSERT INTO public.tb_region_city (id_region, uf, municipio_norm)
SELECT r.id_region, v.uf, fl_norm_city(v.city)
FROM (VALUES
  -- NORTE / AC
  ('AC','Rio Branco e Baixo Acre','Rio Branco'),('AC','Rio Branco e Baixo Acre','Senador Guiomard'),('AC','Rio Branco e Baixo Acre','Bujari'),('AC','Rio Branco e Baixo Acre','Porto Acre'),('AC','Rio Branco e Baixo Acre','Acrelândia'),
  ('AC','Alto Acre','Brasileia'),('AC','Alto Acre','Epitaciolândia'),('AC','Alto Acre','Xapuri'),('AC','Alto Acre','Assis Brasil'),('AC','Alto Acre','Capixaba'),
  ('AC','Vale do Juruá e Interior','Cruzeiro do Sul'),('AC','Vale do Juruá e Interior','Mâncio Lima'),('AC','Vale do Juruá e Interior','Rodrigues Alves'),('AC','Vale do Juruá e Interior','Tarauacá'),('AC','Vale do Juruá e Interior','Feijó'),('AC','Vale do Juruá e Interior','Sena Madureira'),
  -- AM
  ('AM','Manaus e Região Metropolitana','Manaus'),('AM','Manaus e Região Metropolitana','Iranduba'),('AM','Manaus e Região Metropolitana','Manacapuru'),('AM','Manaus e Região Metropolitana','Itacoatiara'),('AM','Manaus e Região Metropolitana','Presidente Figueiredo'),('AM','Manaus e Região Metropolitana','Rio Preto da Eva'),
  ('AM','Alto Solimões e Juruá','Tabatinga'),('AM','Alto Solimões e Juruá','Benjamin Constant'),('AM','Alto Solimões e Juruá','São Paulo de Olivença'),('AM','Alto Solimões e Juruá','Tefé'),('AM','Alto Solimões e Juruá','Eirunepé'),
  ('AM','Interior do Amazonas','Parintins'),('AM','Interior do Amazonas','Maués'),('AM','Interior do Amazonas','Coari'),('AM','Interior do Amazonas','Humaitá'),('AM','Interior do Amazonas','Manicoré'),('AM','Interior do Amazonas','Lábrea'),('AM','Interior do Amazonas','Boca do Acre'),
  -- AP
  ('AP','Macapá e Região Metropolitana','Macapá'),('AP','Macapá e Região Metropolitana','Santana'),('AP','Macapá e Região Metropolitana','Mazagão'),('AP','Macapá e Região Metropolitana','Porto Grande'),
  ('AP','Norte do Amapá','Oiapoque'),('AP','Norte do Amapá','Calçoene'),('AP','Norte do Amapá','Amapá'),('AP','Norte do Amapá','Tartarugalzinho'),
  ('AP','Sul do Amapá / Jari','Laranjal do Jari'),('AP','Sul do Amapá / Jari','Vitória do Jari'),('AP','Sul do Amapá / Jari','Pedra Branca do Amapari'),
  -- PA
  ('PA','Belém e Região Metropolitana','Belém'),('PA','Belém e Região Metropolitana','Ananindeua'),('PA','Belém e Região Metropolitana','Marituba'),('PA','Belém e Região Metropolitana','Benevides'),('PA','Belém e Região Metropolitana','Castanhal'),
  ('PA','Nordeste e Litoral Paraense','Bragança'),('PA','Nordeste e Litoral Paraense','Capanema'),('PA','Nordeste e Litoral Paraense','Salinópolis'),('PA','Nordeste e Litoral Paraense','Abaetetuba'),('PA','Nordeste e Litoral Paraense','Barcarena'),('PA','Nordeste e Litoral Paraense','Cametá'),
  ('PA','Marajó e Baixo Amazonas','Soure'),('PA','Marajó e Baixo Amazonas','Breves'),('PA','Marajó e Baixo Amazonas','Santarém'),('PA','Marajó e Baixo Amazonas','Oriximiná'),('PA','Marajó e Baixo Amazonas','Óbidos'),('PA','Marajó e Baixo Amazonas','Monte Alegre'),
  ('PA','Carajás e Sudeste Paraense','Marabá'),('PA','Carajás e Sudeste Paraense','Parauapebas'),('PA','Carajás e Sudeste Paraense','Canaã dos Carajás'),('PA','Carajás e Sudeste Paraense','Redenção'),('PA','Carajás e Sudeste Paraense','Tucuruí'),('PA','Carajás e Sudeste Paraense','Xinguara'),
  ('PA','Xingu e Tapajós','Altamira'),('PA','Xingu e Tapajós','Itaituba'),('PA','Xingu e Tapajós','Novo Progresso'),('PA','Xingu e Tapajós','Uruará'),('PA','Xingu e Tapajós','Medicilândia'),
  -- RO
  ('RO','Porto Velho e Madeira-Mamoré','Porto Velho'),('RO','Porto Velho e Madeira-Mamoré','Candeias do Jamari'),('RO','Porto Velho e Madeira-Mamoré','Guajará-Mirim'),('RO','Porto Velho e Madeira-Mamoré','Nova Mamoré'),
  ('RO','Centro de Rondônia','Ariquemes'),('RO','Centro de Rondônia','Jaru'),('RO','Centro de Rondônia','Ji-Paraná'),('RO','Centro de Rondônia','Ouro Preto do Oeste'),
  ('RO','Sul de Rondônia','Cacoal'),('RO','Sul de Rondônia','Rolim de Moura'),('RO','Sul de Rondônia','Vilhena'),('RO','Sul de Rondônia','Pimenta Bueno'),('RO','Sul de Rondônia','Cerejeiras'),
  -- RR
  ('RR','Boa Vista e Entorno','Boa Vista'),('RR','Boa Vista e Entorno','Mucajaí'),('RR','Boa Vista e Entorno','Cantá'),('RR','Boa Vista e Entorno','Alto Alegre'),
  ('RR','Norte e Fronteira','Pacaraima'),('RR','Norte e Fronteira','Normandia'),('RR','Norte e Fronteira','Uiramutã'),('RR','Norte e Fronteira','Amajari'),
  ('RR','Sul de Roraima','Rorainópolis'),('RR','Sul de Roraima','Caracaraí'),('RR','Sul de Roraima','São João da Baliza'),('RR','Sul de Roraima','Caroebe'),
  -- TO
  ('TO','Palmas e Região Central','Palmas'),('TO','Palmas e Região Central','Porto Nacional'),('TO','Palmas e Região Central','Paraíso do Tocantins'),('TO','Palmas e Região Central','Miracema'),
  ('TO','Norte do Tocantins / Bico do Papagaio','Araguaína'),('TO','Norte do Tocantins / Bico do Papagaio','Tocantinópolis'),('TO','Norte do Tocantins / Bico do Papagaio','Augustinópolis'),('TO','Norte do Tocantins / Bico do Papagaio','Araguatins'),('TO','Norte do Tocantins / Bico do Papagaio','Colinas'),
  ('TO','Sul e Sudeste do Tocantins','Gurupi'),('TO','Sul e Sudeste do Tocantins','Dianópolis'),('TO','Sul e Sudeste do Tocantins','Alvorada'),('TO','Sul e Sudeste do Tocantins','Formoso do Araguaia'),('TO','Sul e Sudeste do Tocantins','Arraias'),
  -- NORDESTE / AL
  ('AL','Maceió e Região Metropolitana','Maceió'),('AL','Maceió e Região Metropolitana','Rio Largo'),('AL','Maceió e Região Metropolitana','Marechal Deodoro'),('AL','Maceió e Região Metropolitana','Pilar'),('AL','Maceió e Região Metropolitana','Satuba'),
  ('AL','Litoral e Zona da Mata','Maragogi'),('AL','Litoral e Zona da Mata','São Miguel dos Milagres'),('AL','Litoral e Zona da Mata','Porto de Pedras'),('AL','Litoral e Zona da Mata','União dos Palmares'),('AL','Litoral e Zona da Mata','São Luís do Quitunde'),
  ('AL','Agreste e Sertão','Arapiraca'),('AL','Agreste e Sertão','Palmeira dos Índios'),('AL','Agreste e Sertão','Santana do Ipanema'),('AL','Agreste e Sertão','Delmiro Gouveia'),('AL','Agreste e Sertão','Penedo'),
  -- BA
  ('BA','Salvador, RMS e Recôncavo','Salvador'),('BA','Salvador, RMS e Recôncavo','Lauro de Freitas'),('BA','Salvador, RMS e Recôncavo','Camaçari'),('BA','Salvador, RMS e Recôncavo','Simões Filho'),('BA','Salvador, RMS e Recôncavo','Santo Antônio de Jesus'),('BA','Salvador, RMS e Recôncavo','Cruz das Almas'),
  ('BA','Litoral Sul e Extremo Sul','Ilhéus'),('BA','Litoral Sul e Extremo Sul','Itabuna'),('BA','Litoral Sul e Extremo Sul','Porto Seguro'),('BA','Litoral Sul e Extremo Sul','Eunápolis'),('BA','Litoral Sul e Extremo Sul','Teixeira de Freitas'),('BA','Litoral Sul e Extremo Sul','Valença'),
  ('BA','Feira de Santana e Centro-Norte','Feira de Santana'),('BA','Feira de Santana e Centro-Norte','Alagoinhas'),('BA','Feira de Santana e Centro-Norte','Serrinha'),('BA','Feira de Santana e Centro-Norte','Jacobina'),('BA','Feira de Santana e Centro-Norte','Senhor do Bonfim'),
  ('BA','Chapada e Oeste Baiano','Lençóis'),('BA','Chapada e Oeste Baiano','Seabra'),('BA','Chapada e Oeste Baiano','Barreiras'),('BA','Chapada e Oeste Baiano','Luís Eduardo Magalhães'),('BA','Chapada e Oeste Baiano','Irecê'),
  ('BA','Sudoeste e Sertão Baiano','Vitória da Conquista'),('BA','Sudoeste e Sertão Baiano','Jequié'),('BA','Sudoeste e Sertão Baiano','Guanambi'),('BA','Sudoeste e Sertão Baiano','Brumado'),('BA','Sudoeste e Sertão Baiano','Juazeiro'),('BA','Sudoeste e Sertão Baiano','Paulo Afonso'),
  -- CE
  ('CE','Fortaleza e Região Metropolitana','Fortaleza'),('CE','Fortaleza e Região Metropolitana','Caucaia'),('CE','Fortaleza e Região Metropolitana','Maracanaú'),('CE','Fortaleza e Região Metropolitana','Maranguape'),('CE','Fortaleza e Região Metropolitana','Eusébio'),('CE','Fortaleza e Região Metropolitana','Aquiraz'),
  ('CE','Litoral e Norte Cearense','Sobral'),('CE','Litoral e Norte Cearense','Itapipoca'),('CE','Litoral e Norte Cearense','Acaraú'),('CE','Litoral e Norte Cearense','Camocim'),('CE','Litoral e Norte Cearense','Tianguá'),
  ('CE','Sertão Central e Inhamuns','Quixadá'),('CE','Sertão Central e Inhamuns','Quixeramobim'),('CE','Sertão Central e Inhamuns','Canindé'),('CE','Sertão Central e Inhamuns','Crateús'),('CE','Sertão Central e Inhamuns','Tauá'),
  ('CE','Cariri e Sul Cearense','Juazeiro do Norte'),('CE','Cariri e Sul Cearense','Crato'),('CE','Cariri e Sul Cearense','Barbalha'),('CE','Cariri e Sul Cearense','Brejo Santo'),('CE','Cariri e Sul Cearense','Iguatu'),('CE','Cariri e Sul Cearense','Icó'),
  -- MA
  ('MA','São Luís e Ilha','São Luís'),('MA','São Luís e Ilha','São José de Ribamar'),('MA','São Luís e Ilha','Paço do Lumiar'),('MA','São Luís e Ilha','Raposa'),('MA','São Luís e Ilha','Alcântara'),
  ('MA','Litoral, Lençóis e Baixada','Barreirinhas'),('MA','Litoral, Lençóis e Baixada','Tutóia'),('MA','Litoral, Lençóis e Baixada','Pinheiro'),('MA','Litoral, Lençóis e Baixada','Viana'),('MA','Litoral, Lençóis e Baixada','Cururupu'),
  ('MA','Centro e Cocais','Caxias'),('MA','Centro e Cocais','Codó'),('MA','Centro e Cocais','Timon'),('MA','Centro e Cocais','Presidente Dutra'),('MA','Centro e Cocais','Bacabal'),
  ('MA','Sul Maranhense','Imperatriz'),('MA','Sul Maranhense','Açailândia'),('MA','Sul Maranhense','Balsas'),('MA','Sul Maranhense','Carolina'),('MA','Sul Maranhense','Estreito'),
  -- PB
  ('PB','João Pessoa e Litoral','João Pessoa'),('PB','João Pessoa e Litoral','Cabedelo'),('PB','João Pessoa e Litoral','Bayeux'),('PB','João Pessoa e Litoral','Santa Rita'),('PB','João Pessoa e Litoral','Conde'),('PB','João Pessoa e Litoral','Mamanguape'),
  ('PB','Campina Grande e Agreste','Campina Grande'),('PB','Campina Grande e Agreste','Lagoa Seca'),('PB','Campina Grande e Agreste','Queimadas'),('PB','Campina Grande e Agreste','Esperança'),('PB','Campina Grande e Agreste','Guarabira'),
  ('PB','Sertão, Cariri e Alto Sertão','Patos'),('PB','Sertão, Cariri e Alto Sertão','Sousa'),('PB','Sertão, Cariri e Alto Sertão','Cajazeiras'),('PB','Sertão, Cariri e Alto Sertão','Pombal'),('PB','Sertão, Cariri e Alto Sertão','Monteiro'),('PB','Sertão, Cariri e Alto Sertão','Princesa Isabel'),
  -- PE
  ('PE','Recife e Região Metropolitana','Recife'),('PE','Recife e Região Metropolitana','Olinda'),('PE','Recife e Região Metropolitana','Jaboatão dos Guararapes'),('PE','Recife e Região Metropolitana','Paulista'),('PE','Recife e Região Metropolitana','Cabo de Santo Agostinho'),('PE','Recife e Região Metropolitana','Ipojuca'),('PE','Recife e Região Metropolitana','Camaragibe'),
  ('PE','Zona da Mata e Litoral','Goiana'),('PE','Zona da Mata e Litoral','Vitória de Santo Antão'),('PE','Zona da Mata e Litoral','Palmares'),('PE','Zona da Mata e Litoral','Sirinhaém'),
  ('PE','Agreste Pernambucano','Caruaru'),('PE','Agreste Pernambucano','Garanhuns'),('PE','Agreste Pernambucano','Gravatá'),('PE','Agreste Pernambucano','Santa Cruz do Capibaribe'),('PE','Agreste Pernambucano','Toritama'),('PE','Agreste Pernambucano','Belo Jardim'),
  ('PE','Sertão e São Francisco','Petrolina'),('PE','Sertão e São Francisco','Serra Talhada'),('PE','Sertão e São Francisco','Arcoverde'),('PE','Sertão e São Francisco','Salgueiro'),('PE','Sertão e São Francisco','Ouricuri'),('PE','Sertão e São Francisco','Araripina'),
  -- PI
  ('PI','Teresina e Norte do Piauí','Teresina'),('PI','Teresina e Norte do Piauí','Campo Maior'),('PI','Teresina e Norte do Piauí','Piripiri'),('PI','Teresina e Norte do Piauí','Parnaíba'),('PI','Teresina e Norte do Piauí','Luís Correia'),('PI','Teresina e Norte do Piauí','Esperantina'),
  ('PI','Centro e Médio Parnaíba','Picos'),('PI','Centro e Médio Parnaíba','Oeiras'),('PI','Centro e Médio Parnaíba','Valença do Piauí'),('PI','Centro e Médio Parnaíba','Floriano'),
  ('PI','Sul do Piauí','Bom Jesus'),('PI','Sul do Piauí','Uruçuí'),('PI','Sul do Piauí','São Raimundo Nonato'),('PI','Sul do Piauí','Corrente'),('PI','Sul do Piauí','Gilbués'),
  -- RN
  ('RN','Natal e Litoral Leste','Natal'),('RN','Natal e Litoral Leste','Parnamirim'),('RN','Natal e Litoral Leste','São Gonçalo do Amarante'),('RN','Natal e Litoral Leste','Ceará-Mirim'),('RN','Natal e Litoral Leste','Extremoz'),('RN','Natal e Litoral Leste','Tibau do Sul'),
  ('RN','Mossoró e Oeste Potiguar','Mossoró'),('RN','Mossoró e Oeste Potiguar','Apodi'),('RN','Mossoró e Oeste Potiguar','Pau dos Ferros'),('RN','Mossoró e Oeste Potiguar','Areia Branca'),('RN','Mossoró e Oeste Potiguar','Assú'),
  ('RN','Seridó e Agreste','Caicó'),('RN','Seridó e Agreste','Currais Novos'),('RN','Seridó e Agreste','Santa Cruz'),('RN','Seridó e Agreste','Nova Cruz'),('RN','Seridó e Agreste','João Câmara'),
  -- SE
  ('SE','Aracaju e Grande Aracaju','Aracaju'),('SE','Aracaju e Grande Aracaju','Nossa Senhora do Socorro'),('SE','Aracaju e Grande Aracaju','São Cristóvão'),('SE','Aracaju e Grande Aracaju','Barra dos Coqueiros'),
  ('SE','Litoral, Sul e Zona da Mata','Estância'),('SE','Litoral, Sul e Zona da Mata','Itabaianinha'),('SE','Litoral, Sul e Zona da Mata','Lagarto'),('SE','Litoral, Sul e Zona da Mata','Boquim'),
  ('SE','Agreste e Sertão Sergipano','Itabaiana'),('SE','Agreste e Sertão Sergipano','Nossa Senhora da Glória'),('SE','Agreste e Sertão Sergipano','Propriá'),('SE','Agreste e Sertão Sergipano','Canindé de São Francisco'),
  -- SUDESTE / ES
  ('ES','Grande Vitória','Vitória'),('ES','Grande Vitória','Vila Velha'),('ES','Grande Vitória','Serra'),('ES','Grande Vitória','Cariacica'),('ES','Grande Vitória','Viana'),('ES','Grande Vitória','Guarapari'),
  ('ES','Norte Capixaba','Linhares'),('ES','Norte Capixaba','São Mateus'),('ES','Norte Capixaba','Aracruz'),('ES','Norte Capixaba','Colatina'),('ES','Norte Capixaba','Nova Venécia'),
  ('ES','Sul, Serrana e Caparaó','Cachoeiro de Itapemirim'),('ES','Sul, Serrana e Caparaó','Castelo'),('ES','Sul, Serrana e Caparaó','Alegre'),('ES','Sul, Serrana e Caparaó','Venda Nova do Imigrante'),('ES','Sul, Serrana e Caparaó','Domingos Martins'),
  -- MG
  ('MG','Belo Horizonte e Região Metropolitana','Belo Horizonte'),('MG','Belo Horizonte e Região Metropolitana','Contagem'),('MG','Belo Horizonte e Região Metropolitana','Betim'),('MG','Belo Horizonte e Região Metropolitana','Nova Lima'),('MG','Belo Horizonte e Região Metropolitana','Ribeirão das Neves'),('MG','Belo Horizonte e Região Metropolitana','Sete Lagoas'),
  ('MG','Zona da Mata e Campo das Vertentes','Juiz de Fora'),('MG','Zona da Mata e Campo das Vertentes','Barbacena'),('MG','Zona da Mata e Campo das Vertentes','Viçosa'),('MG','Zona da Mata e Campo das Vertentes','Ubá'),('MG','Zona da Mata e Campo das Vertentes','São João del-Rei'),
  ('MG','Sul de Minas e Mantiqueira','Pouso Alegre'),('MG','Sul de Minas e Mantiqueira','Poços de Caldas'),('MG','Sul de Minas e Mantiqueira','Varginha'),('MG','Sul de Minas e Mantiqueira','Lavras'),('MG','Sul de Minas e Mantiqueira','Itajubá'),('MG','Sul de Minas e Mantiqueira','Passos'),
  ('MG','Triângulo e Alto Paranaíba','Uberlândia'),('MG','Triângulo e Alto Paranaíba','Uberaba'),('MG','Triângulo e Alto Paranaíba','Patos de Minas'),('MG','Triângulo e Alto Paranaíba','Araxá'),('MG','Triângulo e Alto Paranaíba','Araguari'),
  ('MG','Centro-Oeste e Noroeste Mineiro','Divinópolis'),('MG','Centro-Oeste e Noroeste Mineiro','Itaúna'),('MG','Centro-Oeste e Noroeste Mineiro','Formiga'),('MG','Centro-Oeste e Noroeste Mineiro','Pará de Minas'),('MG','Centro-Oeste e Noroeste Mineiro','Unaí'),('MG','Centro-Oeste e Noroeste Mineiro','Paracatu'),
  ('MG','Norte, Leste e Vales Mineiros','Montes Claros'),('MG','Norte, Leste e Vales Mineiros','Governador Valadares'),('MG','Norte, Leste e Vales Mineiros','Ipatinga'),('MG','Norte, Leste e Vales Mineiros','Teófilo Otoni'),('MG','Norte, Leste e Vales Mineiros','Diamantina'),('MG','Norte, Leste e Vales Mineiros','Araçuaí'),
  -- RJ
  ('RJ','Capital e Grande Rio','Rio de Janeiro'),('RJ','Capital e Grande Rio','Niterói'),('RJ','Capital e Grande Rio','São Gonçalo'),('RJ','Capital e Grande Rio','Duque de Caxias'),('RJ','Capital e Grande Rio','Nova Iguaçu'),('RJ','Capital e Grande Rio','São João de Meriti'),('RJ','Capital e Grande Rio','Belford Roxo'),
  ('RJ','Região dos Lagos e Norte Fluminense','Cabo Frio'),('RJ','Região dos Lagos e Norte Fluminense','Arraial do Cabo'),('RJ','Região dos Lagos e Norte Fluminense','Búzios'),('RJ','Região dos Lagos e Norte Fluminense','Macaé'),('RJ','Região dos Lagos e Norte Fluminense','Campos dos Goytacazes'),('RJ','Região dos Lagos e Norte Fluminense','São João da Barra'),
  ('RJ','Serrana e Centro-Sul','Petrópolis'),('RJ','Serrana e Centro-Sul','Teresópolis'),('RJ','Serrana e Centro-Sul','Nova Friburgo'),('RJ','Serrana e Centro-Sul','Três Rios'),('RJ','Serrana e Centro-Sul','Vassouras'),
  ('RJ','Costa Verde e Médio Paraíba','Angra dos Reis'),('RJ','Costa Verde e Médio Paraíba','Paraty'),('RJ','Costa Verde e Médio Paraíba','Mangaratiba'),('RJ','Costa Verde e Médio Paraíba','Volta Redonda'),('RJ','Costa Verde e Médio Paraíba','Barra Mansa'),('RJ','Costa Verde e Médio Paraíba','Resende'),
  -- SP
  ('SP','Capital e Grande São Paulo','São Paulo'),('SP','Capital e Grande São Paulo','Santo André'),('SP','Capital e Grande São Paulo','São Bernardo do Campo'),('SP','Capital e Grande São Paulo','São Caetano do Sul'),('SP','Capital e Grande São Paulo','Diadema'),('SP','Capital e Grande São Paulo','Mauá'),('SP','Capital e Grande São Paulo','Osasco'),('SP','Capital e Grande São Paulo','Barueri'),('SP','Capital e Grande São Paulo','Guarulhos'),('SP','Capital e Grande São Paulo','Mogi das Cruzes'),('SP','Capital e Grande São Paulo','Suzano'),
  ('SP','Litoral e Vale do Paraíba','Santos'),('SP','Litoral e Vale do Paraíba','São Vicente'),('SP','Litoral e Vale do Paraíba','Praia Grande'),('SP','Litoral e Vale do Paraíba','Guarujá'),('SP','Litoral e Vale do Paraíba','Ubatuba'),('SP','Litoral e Vale do Paraíba','Caraguatatuba'),('SP','Litoral e Vale do Paraíba','São José dos Campos'),('SP','Litoral e Vale do Paraíba','Taubaté'),('SP','Litoral e Vale do Paraíba','Jacareí'),('SP','Litoral e Vale do Paraíba','Registro'),
  ('SP','Campinas e Interior Central','Campinas'),('SP','Campinas e Interior Central','Jundiaí'),('SP','Campinas e Interior Central','Americana'),('SP','Campinas e Interior Central','Hortolândia'),('SP','Campinas e Interior Central','Sumaré'),('SP','Campinas e Interior Central','Indaiatuba'),('SP','Campinas e Interior Central','Piracicaba'),('SP','Campinas e Interior Central','Limeira'),('SP','Campinas e Interior Central','Rio Claro'),
  ('SP','Sorocaba e Sudoeste','Sorocaba'),('SP','Sorocaba e Sudoeste','Votorantim'),('SP','Sorocaba e Sudoeste','Itu'),('SP','Sorocaba e Sudoeste','Salto'),('SP','Sorocaba e Sudoeste','São Roque'),('SP','Sorocaba e Sudoeste','Tatuí'),('SP','Sorocaba e Sudoeste','Itapetininga'),('SP','Sorocaba e Sudoeste','Avaré'),
  ('SP','Norte Paulista','Ribeirão Preto'),('SP','Norte Paulista','Franca'),('SP','Norte Paulista','Sertãozinho'),('SP','Norte Paulista','Barretos'),('SP','Norte Paulista','Araraquara'),('SP','Norte Paulista','São Carlos'),('SP','Norte Paulista','Matão'),
  ('SP','Oeste Paulista','Bauru'),('SP','Oeste Paulista','Marília'),('SP','Oeste Paulista','Ourinhos'),('SP','Oeste Paulista','Assis'),('SP','Oeste Paulista','São José do Rio Preto'),('SP','Oeste Paulista','Araçatuba'),('SP','Oeste Paulista','Presidente Prudente'),('SP','Oeste Paulista','Dracena'),
  -- SUL / PR
  ('PR','Curitiba e Região Metropolitana','Curitiba'),('PR','Curitiba e Região Metropolitana','São José dos Pinhais'),('PR','Curitiba e Região Metropolitana','Colombo'),('PR','Curitiba e Região Metropolitana','Araucária'),('PR','Curitiba e Região Metropolitana','Pinhais'),('PR','Curitiba e Região Metropolitana','Campo Largo'),
  ('PR','Litoral e Campos Gerais','Paranaguá'),('PR','Litoral e Campos Gerais','Matinhos'),('PR','Litoral e Campos Gerais','Guaratuba'),('PR','Litoral e Campos Gerais','Ponta Grossa'),('PR','Litoral e Campos Gerais','Castro'),('PR','Litoral e Campos Gerais','Telêmaco Borba'),
  ('PR','Norte e Noroeste Paranaense','Londrina'),('PR','Norte e Noroeste Paranaense','Maringá'),('PR','Norte e Noroeste Paranaense','Apucarana'),('PR','Norte e Noroeste Paranaense','Arapongas'),('PR','Norte e Noroeste Paranaense','Cianorte'),('PR','Norte e Noroeste Paranaense','Paranavaí'),('PR','Norte e Noroeste Paranaense','Umuarama'),
  ('PR','Oeste e Sudoeste Paranaense','Cascavel'),('PR','Oeste e Sudoeste Paranaense','Foz do Iguaçu'),('PR','Oeste e Sudoeste Paranaense','Toledo'),('PR','Oeste e Sudoeste Paranaense','Francisco Beltrão'),('PR','Oeste e Sudoeste Paranaense','Pato Branco'),
  -- RS
  ('RS','Porto Alegre e Região Metropolitana','Porto Alegre'),('RS','Porto Alegre e Região Metropolitana','Canoas'),('RS','Porto Alegre e Região Metropolitana','Gravataí'),('RS','Porto Alegre e Região Metropolitana','Novo Hamburgo'),('RS','Porto Alegre e Região Metropolitana','São Leopoldo'),('RS','Porto Alegre e Região Metropolitana','Viamão'),
  ('RS','Serra Gaúcha e Hortênsias','Caxias do Sul'),('RS','Serra Gaúcha e Hortênsias','Bento Gonçalves'),('RS','Serra Gaúcha e Hortênsias','Farroupilha'),('RS','Serra Gaúcha e Hortênsias','Gramado'),('RS','Serra Gaúcha e Hortênsias','Canela'),
  ('RS','Litoral e Sul Gaúcho','Pelotas'),('RS','Litoral e Sul Gaúcho','Rio Grande'),('RS','Litoral e Sul Gaúcho','Santa Vitória do Palmar'),('RS','Litoral e Sul Gaúcho','Tramandaí'),('RS','Litoral e Sul Gaúcho','Capão da Canoa'),
  ('RS','Centro e Vales','Santa Maria'),('RS','Centro e Vales','Cachoeira do Sul'),('RS','Centro e Vales','Lajeado'),('RS','Centro e Vales','Santa Cruz do Sul'),('RS','Centro e Vales','Venâncio Aires'),
  ('RS','Norte, Missões e Fronteira','Passo Fundo'),('RS','Norte, Missões e Fronteira','Erechim'),('RS','Norte, Missões e Fronteira','Ijuí'),('RS','Norte, Missões e Fronteira','Santo Ângelo'),('RS','Norte, Missões e Fronteira','Cruz Alta'),('RS','Norte, Missões e Fronteira','Uruguaiana'),('RS','Norte, Missões e Fronteira','Santana do Livramento'),
  -- SC
  ('SC','Grande Florianópolis e Litoral Sul','Florianópolis'),('SC','Grande Florianópolis e Litoral Sul','São José'),('SC','Grande Florianópolis e Litoral Sul','Palhoça'),('SC','Grande Florianópolis e Litoral Sul','Biguaçu'),('SC','Grande Florianópolis e Litoral Sul','Criciúma'),('SC','Grande Florianópolis e Litoral Sul','Tubarão'),
  ('SC','Vale do Itajaí e Norte Catarinense','Blumenau'),('SC','Vale do Itajaí e Norte Catarinense','Itajaí'),('SC','Vale do Itajaí e Norte Catarinense','Balneário Camboriú'),('SC','Vale do Itajaí e Norte Catarinense','Joinville'),('SC','Vale do Itajaí e Norte Catarinense','Jaraguá do Sul'),('SC','Vale do Itajaí e Norte Catarinense','São Bento do Sul'),
  ('SC','Oeste Catarinense','Chapecó'),('SC','Oeste Catarinense','Concórdia'),('SC','Oeste Catarinense','Joaçaba'),('SC','Oeste Catarinense','Videira'),('SC','Oeste Catarinense','Xanxerê'),('SC','Oeste Catarinense','São Miguel do Oeste'),
  ('SC','Serra e Planalto Catarinense','Lages'),('SC','Serra e Planalto Catarinense','Curitibanos'),('SC','Serra e Planalto Catarinense','São Joaquim'),('SC','Serra e Planalto Catarinense','Mafra'),('SC','Serra e Planalto Catarinense','Canoinhas'),
  -- CENTRO-OESTE / DF
  ('DF','Distrito Federal','Brasília'),('DF','Distrito Federal','Ceilândia'),('DF','Distrito Federal','Taguatinga'),('DF','Distrito Federal','Samambaia'),('DF','Distrito Federal','Gama'),('DF','Distrito Federal','Sobradinho'),('DF','Distrito Federal','Planaltina'),('DF','Distrito Federal','Guará'),('DF','Distrito Federal','Águas Claras'),
  -- GO
  ('GO','Goiânia, Anápolis e Região Metropolitana','Goiânia'),('GO','Goiânia, Anápolis e Região Metropolitana','Aparecida de Goiânia'),('GO','Goiânia, Anápolis e Região Metropolitana','Trindade'),('GO','Goiânia, Anápolis e Região Metropolitana','Senador Canedo'),('GO','Goiânia, Anápolis e Região Metropolitana','Anápolis'),
  ('GO','Entorno do DF e Nordeste Goiano','Luziânia'),('GO','Entorno do DF e Nordeste Goiano','Valparaíso de Goiás'),('GO','Entorno do DF e Nordeste Goiano','Águas Lindas de Goiás'),('GO','Entorno do DF e Nordeste Goiano','Formosa'),('GO','Entorno do DF e Nordeste Goiano','Planaltina de Goiás'),('GO','Entorno do DF e Nordeste Goiano','Cristalina'),
  ('GO','Sul e Sudoeste Goiano','Rio Verde'),('GO','Sul e Sudoeste Goiano','Jataí'),('GO','Sul e Sudoeste Goiano','Catalão'),('GO','Sul e Sudoeste Goiano','Itumbiara'),('GO','Sul e Sudoeste Goiano','Mineiros'),('GO','Sul e Sudoeste Goiano','Caldas Novas'),
  ('GO','Norte e Oeste Goiano','Uruaçu'),('GO','Norte e Oeste Goiano','Porangatu'),('GO','Norte e Oeste Goiano','Goianésia'),('GO','Norte e Oeste Goiano','Ceres'),('GO','Norte e Oeste Goiano','Goiás'),('GO','Norte e Oeste Goiano','Iporá'),
  -- MS
  ('MS','Campo Grande e Região Central','Campo Grande'),('MS','Campo Grande e Região Central','Sidrolândia'),('MS','Campo Grande e Região Central','Terenos'),('MS','Campo Grande e Região Central','Ribas do Rio Pardo'),
  ('MS','Dourados e Sul/Fronteira','Dourados'),('MS','Dourados e Sul/Fronteira','Ponta Porã'),('MS','Dourados e Sul/Fronteira','Naviraí'),('MS','Dourados e Sul/Fronteira','Amambai'),('MS','Dourados e Sul/Fronteira','Caarapó'),
  ('MS','Pantanal, Norte e Bolsão','Corumbá'),('MS','Pantanal, Norte e Bolsão','Ladário'),('MS','Pantanal, Norte e Bolsão','Aquidauana'),('MS','Pantanal, Norte e Bolsão','Coxim'),('MS','Pantanal, Norte e Bolsão','Três Lagoas'),('MS','Pantanal, Norte e Bolsão','Paranaíba'),
  -- MT
  ('MT','Cuiabá e Região Metropolitana','Cuiabá'),('MT','Cuiabá e Região Metropolitana','Várzea Grande'),('MT','Cuiabá e Região Metropolitana','Chapada dos Guimarães'),('MT','Cuiabá e Região Metropolitana','Santo Antônio do Leverger'),
  ('MT','Norte Mato-grossense','Sinop'),('MT','Norte Mato-grossense','Sorriso'),('MT','Norte Mato-grossense','Lucas do Rio Verde'),('MT','Norte Mato-grossense','Alta Floresta'),('MT','Norte Mato-grossense','Colíder'),
  ('MT','Sul e Sudeste Mato-grossense','Rondonópolis'),('MT','Sul e Sudeste Mato-grossense','Primavera do Leste'),('MT','Sul e Sudeste Mato-grossense','Barra do Garças'),('MT','Sul e Sudeste Mato-grossense','Jaciara'),('MT','Sul e Sudeste Mato-grossense','Campo Verde'),
  ('MT','Oeste e Pantanal Mato-grossense','Cáceres'),('MT','Oeste e Pantanal Mato-grossense','Tangará da Serra'),('MT','Oeste e Pantanal Mato-grossense','Pontes e Lacerda'),('MT','Oeste e Pantanal Mato-grossense','Comodoro')
) AS v(uf, region_name, city)
JOIN public.tb_region r ON r.uf = v.uf AND r.name = v.region_name
ON CONFLICT (uf, municipio_norm) DO NOTHING;

-- ─── Backfill: resolve a região dos perfis já existentes pela cidade ──────────
UPDATE public.tb_profile p
SET id_region = rc.id_region
FROM public.tb_region_city rc
WHERE rc.uf = p.estado
  AND p.municipio IS NOT NULL
  AND rc.municipio_norm = fl_norm_city(p.municipio)
  AND p.id_region IS DISTINCT FROM rc.id_region;
