// scripts/reseal-secrets.js
// Re-sela com a chave PREFERIDA (`SECRET_BOX_KEY`) todo segredo que ainda está
// selado com o fallback histórico (`JWT_SECRET`).
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// `utils/secretBox` ABRE com as duas chaves, então definir `SECRET_BOX_KEY` já
// é seguro por si só — nada quebra no dia da mudança. O que continua preso é a
// ROTAÇÃO do `JWT_SECRET`: enquanto houver segredo selado com ele, trocá-lo
// torna aquele segredo irrecuperável.
//
// Este script é o que corta essa amarra. Depois de rodá-lo com as DUAS
// variáveis presentes, o `JWT_SECRET` deixa de guardar qualquer segredo.
//
// ⚠️ RODAR COM AS DUAS NO AMBIENTE. Só com a nova, nada abre e o script não faz
// nada (e diz isso). É idempotente: o que já está na chave preferida é pulado.
//
// Uso:
//   node scripts/reseal-secrets.js            # simulação (não grava)
//   node scripts/reseal-secrets.js --apply    # grava

require("dotenv").config();

const pool = require("../src/databases");
const { seal, open, isSealedWithPreferredKey } = require("../src/utils/secretBox");

// Toda coluna do sistema que guarda valor do secretBox. ⚠️ COLUNA NOVA SELADA
// ENTRA AQUI — fora desta lista ela fica presa ao JWT_SECRET para sempre, e
// ninguém descobre até a rotação quebrar aquele recurso.
const ALVOS = [
  { tabela: "tb_academy", pk: "id_academy", coluna: "api_token_enc" },
  { tabela: "tb_whatsapp_instance", pk: "id_instance", coluna: "access_token_sealed" },
  { tabela: "tb_ai_provider_key", pk: "provider", coluna: "api_key_sealed" },
];

const APPLY = process.argv.includes("--apply");

(async () => {
  if (!process.env.SECRET_BOX_KEY) {
    console.log("SECRET_BOX_KEY não está definida — nada a fazer.");
    console.log("Defina-a (e mantenha o JWT_SECRET) e rode de novo.");
    process.exit(0);
  }

  let total = 0;
  let reselados = 0;
  let presos = 0;

  for (const { tabela, pk, coluna } of ALVOS) {
    const existe = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [tabela, coluna]
    );
    if (!existe.rowCount) {
      console.log(`- ${tabela}.${coluna}: coluna não existe neste banco, pulando.`);
      continue;
    }

    const r = await pool.query(
      `SELECT ${pk} AS id, ${coluna} AS valor FROM public.${tabela}
        WHERE ${coluna} IS NOT NULL AND ${coluna}::text LIKE 'v1:%'`
    );
    total += r.rowCount;

    for (const linha of r.rows) {
      if (isSealedWithPreferredKey(linha.valor)) continue; // já está na chave nova

      let plano;
      try {
        plano = open(linha.valor);
      } catch {
        // Nem a preferida nem o fallback abriram: este segredo já estava
        // perdido ANTES deste script. Não é ele que quebra — mas é aqui que
        // se descobre, e é melhor descobrir agora do que numa chamada real.
        presos += 1;
        console.log(`  ⚠️ ${tabela}.${pk}=${linha.id}: NÃO abre com nenhuma chave conhecida.`);
        continue;
      }

      if (APPLY) {
        await pool.query(`UPDATE public.${tabela} SET ${coluna} = $2 WHERE ${pk} = $1`, [
          linha.id,
          seal(plano),
        ]);
      }
      reselados += 1;
      console.log(`  ${APPLY ? "re-selado" : "re-selaria"} ${tabela}.${pk}=${linha.id}`);
    }
  }

  console.log(
    `\n${APPLY ? "Aplicado" : "Simulação"}: ${reselados} de ${total} selado(s) ` +
      `${APPLY ? "migrados" : "a migrar"}${presos ? `, ${presos} irrecuperável(is)` : ""}.`
  );
  if (!APPLY && reselados) console.log("Rode de novo com --apply para gravar.");
  await pool.end();
})().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
