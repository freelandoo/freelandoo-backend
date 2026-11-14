-- 454 — Segurança A6: o segredo de assinatura do webhook das conexões de API passa a ser guardado
-- SELADO (secretBox, "v1:..."), que não cabe em VARCHAR(64). Alarga para TEXT (idempotente: repetir
-- o ALTER para o mesmo tipo não muda nada). As linhas antigas em texto puro são seladas na primeira
-- leitura do despacho (WebhookDispatchService) ou pelo scripts/reseal-secrets.js.
ALTER TABLE public.tb_api_connection ALTER COLUMN webhook_secret TYPE TEXT;
