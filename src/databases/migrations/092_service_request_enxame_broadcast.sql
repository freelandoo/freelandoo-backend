-- 092_service_request_enxame_broadcast.sql
-- Permite O.S. com escopo "todo o Enxame": id_category passa a aceitar NULL.
-- Profissionais de qualquer profissão dentro do enxame escolhido recebem.

ALTER TABLE tb_service_request
  ALTER COLUMN id_category DROP NOT NULL;

-- Reindex: o índice antigo (id_machine, id_category, status) continua válido,
-- porque NULL em id_category é aceito em B-tree. Sem mudança necessária.
