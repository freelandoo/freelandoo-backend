-- 245_whatsapp_flag_text.sql
-- A descrição da flag do WhatsApp no Painel de Controle passou a MENTIR.
--
-- ─── POR QUE ISTO É UMA MIGRATION, E NÃO UM UPDATE NA MÃO ───────────────────
--
-- O texto foi semeado pela mig 223, que JÁ RODOU em produção — e migration
-- aplicada não se edita: o runner compara checksum no boot e aborta com exit 1
-- (produção fora do ar). Corrigir na origem seria trocar o texto para quem
-- roda banco virgem e deixar produção com o texto velho, que é a divergência
-- exata que este arquivo existe para fechar.
--
-- ─── O QUE ESTAVA ERRADO ────────────────────────────────────────────────────
--
-- A 223 descrevia a Evolution (Baileys): "conecta por QR Code" e "só aparece
-- conectável se EVOLUTION_URL e EVOLUTION_API_KEY estiverem configuradas". A
-- mig 240 trouxe a Cloud API oficial da Meta, onde NÃO EXISTE QR: o número é
-- cadastrado no WABA e confirmado por um código que a Meta manda por SMS ou
-- chamada. E quem decide se a aba é conectável passou a ser o registry
-- (`integrations/whatsappProvider`), que prefere a Cloud quando as ENVs dela
-- existem e só cai na Evolution depois.
--
-- ⚠️ Texto de painel não é cosmético: é por ele que se decide LIGAR ou
-- DESLIGAR a feature, e ele é a única explicação que o admin tem na tela. Um
-- que nomeia as ENVs erradas manda conferir o lugar errado quando a aba
-- aparecer como "não configurada" — e o sintoma é indistinguível de defeito.
--
-- ─── O `WHERE` PRESERVA EDIÇÃO HUMANA ───────────────────────────────────────
--
-- A tabela é admin-editável (`updated_by`). O UPDATE casa o texto LEGADO, não
-- a chave: corrige só quem ainda está com a frase da 223, nunca por cima de
-- uma redação que alguém escreveu depois. De quebra, a 2ª passada é no-op —
-- que é o que idempotência quer dizer aqui.

UPDATE public.tb_feature_flag
   SET description = 'Aba WhatsApp dentro de Solicitações (/mensagens): a pessoa conecta o número dela e atende as conversas dentro da Freelandoo. Pela Cloud API oficial da Meta o número é cadastrado no WABA da Freelandoo e confirmado por um código enviado por SMS ou chamada — não há QR Code; o QR existe só no caminho legado da Evolution. Desligar esconde a aba e bloqueia conexão e envio; o histórico já recebido é preservado, e desconectar continua funcionando (porta de saída não se tranca). Só aparece conectável se as credenciais de algum provedor estiverem configuradas: META_APP_ID, META_APP_SECRET, META_SYSTEM_USER_TOKEN e META_WABA_ID para a Cloud API; EVOLUTION_URL e EVOLUTION_API_KEY para a Evolution.',
       updated_at = NOW()
 WHERE flag_key = 'whatsapp_atendimento'
   AND description LIKE '%EVOLUTION_URL e EVOLUTION_API_KEY estiverem configuradas.%';
