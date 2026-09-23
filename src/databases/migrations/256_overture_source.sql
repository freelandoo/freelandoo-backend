-- =============================================================================
-- Migration 256: `overture` entra como fonte de descoberta.
--
-- ─── POR QUE ─────────────────────────────────────────────────────────────────
--
-- A descoberta nasceu no OpenStreetMap, e o OSM cobre bem o que tem fachada de
-- destino e quase ignora o resto. Medido em SP: 821 barbearias no estado
-- inteiro, e ZERO em Diadema — conferido na própria fonte, não deduzido. Com a
-- base respondendo "nada por aqui" numa cidade de 400 mil habitantes, a leitura
-- natural de quem olha é que a feature não funciona.
--
-- O Overture Maps responde a mesma pergunta com dado de operação comercial
-- (Meta, Microsoft, PinMeTo, Foursquare): 43.250 barbearias em SP, 302 em
-- Diadema, 93% com telefone. Na região metropolitana são 837 mil lugares, dos
-- quais 516 mil com celular — o número que o filtro "com WhatsApp" existe para
-- achar e que hoje quase não encontra ninguém.
--
-- ⚠️ ISTO É SÓ O CHECK. A fonte precisa estar declarada em TRÊS lugares, e o
-- contrato do registry (`integrations/companyProvider/index.js`) diz por quê:
-- faltando aqui, o INSERT é recusado pelo banco; faltando em
-- `utils/companyConfidence.js`, ela grava com confiança 0 e NUNCA vence ninguém
-- — e esse segundo caso é silencioso, porque a linha entra e some na disputa
-- de campo sem erro nenhum.
--
-- ⚠️ SUPERSET COM O MESMO NOME DE CONSTRAINT, que é a regra das migs 153, 197,
-- 206 e 246. Nome novo deixaria a constraint ANTIGA de pé em paralelo, e ela
-- continuaria recusando 'overture' — o sintoma seria a ingestão falhando em
-- produção com a migration marcada como aplicada.
--
-- ⚠️ NENHUM VALOR SAI. 'osm' continua aceito porque descreve o que a coluna
-- PODE TER TIDO ao longo da vida do banco — há linhas dele gravadas hoje, e o
-- CHECK não é sobre quem descobre amanhã. Quem decide isso é o registry.
--
-- Idempotente: DROP IF EXISTS antes do ADD.
-- =============================================================================

ALTER TABLE tb_company_source
  DROP CONSTRAINT IF EXISTS chk_company_source_kind;

ALTER TABLE tb_company_source
  ADD CONSTRAINT chk_company_source_kind
  CHECK (source IN ('cnpj', 'osm', 'overture', 'website', 'social', 'directory', 'manual'));
