-- =============================================================================
-- Migration 279: SAVES DO EVO BRAZIL NA CONTA — 5 slots por pessoa
-- =============================================================================
-- Pedido do Alex (2026-10-13): o progresso do jogo morava SÓ no navegador
-- (`user://rancho.json` = IndexedDB da origem). Preso àquele navegador, sujeito
-- ao Safari apagar sozinho, e ninguém conseguia zerar de fora. Agora o jogo
-- NÃO salva sozinho: o jogador aperta SALVAR no menu do estábulo e escolhe um
-- de 5 slots; CARREGAR lê de volta. É o save da CONTA — vale no /jogar, no
-- /monsters e no app, em qualquer aparelho.
--
-- `data` é o JSON do save como o jogo o monta (`Criacao.para_save`), versionado
-- pelo próprio jogo (`game_version`); o backend não interpreta o conteúdo, só o
-- guarda — quem migra formato antigo é o jogo (`_migra`). `summary` é o que a
-- tela de slots mostra sem baixar o save inteiro (nome do bicho, data do jogo,
-- créditos, ranking), também montado pelo jogo.
--
-- Custo: um save de meses de jogo dá ~100–200 KB (as listas internas têm teto)
-- e o slot é SOBRESCRITO, não acumula. Gravação é manual, então o WAL não
-- incha com autosave.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_game_save (
  id_user       UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  slot          SMALLINT NOT NULL,
  data          JSONB NOT NULL,
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_version  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, slot)
);

ALTER TABLE public.tb_game_save DROP CONSTRAINT IF EXISTS chk_game_save_slot;
ALTER TABLE public.tb_game_save
  ADD CONSTRAINT chk_game_save_slot CHECK (slot BETWEEN 1 AND 5);
