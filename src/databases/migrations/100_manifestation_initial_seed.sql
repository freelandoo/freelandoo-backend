-- =============================================================================
-- Migration 100: Manifestação — seed inicial (preço 500 P + tag adjetivo)
-- =============================================================================
-- One-shot: alinha preço pra 500 polens e gera tag_label (adjetivo derivado
-- do nome) para os produtos atuais. Guards garantem que só rode enquanto os
-- valores estão na semente — qualquer edição posterior do admin não é
-- sobrescrita.

-- 1. Preço padrão 500 P (só onde ainda está nos valores antigos 25/50).
UPDATE public.manifestation_products
   SET price_polens = 500,
       updated_at   = NOW()
 WHERE price_polens IN (25, 50);

-- 2. tag_label = adjetivo do nome (só onde ainda está NULL/vazio ou no valor
--    semente do produto "russia"). NULL ocorre porque o catálogo foi populado
--    sem preencher a tag, apesar da constraint NOT NULL original.
UPDATE public.manifestation_products SET
  tag_label = CASE name
    WHEN 'russia'        THEN 'Russo'
    WHEN 'Prosperidade'  THEN 'Próspero'
    WHEN 'Resiliência'   THEN 'Resiliente'
    WHEN 'Ambição'       THEN 'Ambicioso'
    WHEN 'Disciplina'    THEN 'Disciplinado'
    WHEN 'Evolução'      THEN 'Evoluído'
    WHEN 'Coragem'       THEN 'Corajoso'
    WHEN 'Foco'          THEN 'Focado'
    WHEN 'Vitória'       THEN 'Vitorioso'
    WHEN 'Liberdade'     THEN 'Livre'
    WHEN 'Determinação'  THEN 'Determinado'
    WHEN 'Alegria'       THEN 'Alegre'
    WHEN 'Bravo'         THEN 'Bravo'
    WHEN 'Raiva'         THEN 'Raivoso'
    WHEN 'Feliz'         THEN 'Feliz'
    WHEN 'Alegre'        THEN 'Alegre'
    WHEN 'Cansado'       THEN 'Cansado'
    WHEN 'Ansioso'       THEN 'Ansioso'
    WHEN 'Deprê'         THEN 'Deprimido'
    WHEN 'Fome'          THEN 'Faminto'
    WHEN 'Carente'       THEN 'Carente'
    WHEN 'Solteiro'      THEN 'Solteiro'
    WHEN 'Apaixonado'    THEN 'Apaixonado'
    WHEN 'Confiante'     THEN 'Confiante'
    WHEN 'Esperançoso'   THEN 'Esperançoso'
    WHEN 'Grato'         THEN 'Grato'
    WHEN 'Ousado'        THEN 'Ousado'
    WHEN 'Sereno'        THEN 'Sereno'
    WHEN 'Livre'         THEN 'Livre'
    WHEN 'Calmo'         THEN 'Calmo'
    WHEN 'Inspirado'     THEN 'Inspirado'
    ELSE tag_label
  END,
  updated_at = NOW()
 WHERE name IN (
   'russia','Prosperidade','Resiliência','Ambição','Disciplina','Evolução',
   'Coragem','Foco','Vitória','Liberdade','Determinação','Alegria','Bravo',
   'Raiva','Feliz','Alegre','Cansado','Ansioso','Deprê','Fome','Carente',
   'Solteiro','Apaixonado','Confiante','Esperançoso','Grato','Ousado',
   'Sereno','Livre','Calmo','Inspirado'
 )
 AND (tag_label IS NULL OR tag_label = '' OR tag_label = 'Russia');
