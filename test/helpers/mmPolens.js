// test/helpers/mmPolens.js — suítes do Meu Mundo (mm3d-30): a vida grava o
// histórico do sino (mig 302) e a loja pode cobrar em Poléns. Cria as tabelas
// de Poléns no formato de produção (o que a 302 e o PolenStorage usam) e
// apaga as do sino/correio de uma rodada anterior. Só Postgres local.

async function polenTables(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_notice, tb_mm_mail, tb_mm_inbox_pref, polen_transactions, polen_wallets CASCADE`);
  await pool.query(`CREATE TABLE polen_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES tb_user(id_user) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0,
    lifetime_earned INTEGER NOT NULL DEFAULT 0,
    lifetime_spent INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT polen_wallets_nonnegative CHECK (balance >= 0 AND lifetime_earned >= 0 AND lifetime_spent >= 0))`);
  await pool.query(`CREATE TABLE polen_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES tb_user(id_user) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES polen_wallets(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    source TEXT,
    source_id TEXT,
    status TEXT NOT NULL DEFAULT 'posted',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE UNIQUE INDEX ux_polen_transactions_source ON polen_transactions (source, source_id)
    WHERE source IS NOT NULL AND source_id IS NOT NULL AND status = 'posted'`);
}

module.exports = { polenTables };
