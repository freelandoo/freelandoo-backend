/**
 * Cria a conta provisória de um cliente e a comunidade do negócio dele.
 *
 * Conta provisória existe para entregar o site antes de termos os dados da
 * pessoa: entra sem CPF e sem nascimento até `cpf_waived_until` (mig 326), e aí
 * o gate de identidade volta sozinho. Termos NÃO são aceitos aqui: quem aceita
 * é o dono, no primeiro login.
 *
 * Idempotente: e-mail já cadastrado não é recriado.
 *
 * Uso: node scripts/create-provisional-account.js <arquivo.json>
 * { nome, username, email, senha, estado, municipio, id_category, id_machine,
 *   community: { display_name, bio }, dias }
 */
require("dotenv").config();

const bcrypt = require("bcrypt");
const pool = require("../src/databases");
const AuthStorage = require("../src/storages/AuthStorage");
const CommunityService = require("../src/services/CommunityService");

async function main() {
  const spec = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
  const email = spec.email.trim().toLowerCase();
  const client = await pool.connect();
  let id_user;
  try {
    if (await AuthStorage.findUserIdByEmail(client, email)) {
      throw new Error(`Conta já existe: ${email}`);
    }
    await client.query("BEGIN");
    const user = await AuthStorage.createUser(client, {
      nome: spec.nome,
      username: spec.username,
      email,
      senhaHash: await bcrypt.hash(spec.senha, 10),
      data_nascimento: null,
      cpf: null,
      sexo: null,
      estado: spec.estado,
      municipio: spec.municipio,
      ativo: true,
    });
    id_user = user.id_user;
    await client.query(
      `UPDATE public.tb_user
          SET cpf_waived_until = NOW() + make_interval(days => $2::int)
        WHERE id_user = $1`,
      [id_user, spec.dias || 7],
    );
    // Mesma escrita do passo 2 do onboarding (OnboardingService).
    await client.query(
      `UPDATE public.tb_profile
          SET id_category = $1, estado = $2::text, municipio = $3::text,
              id_region = (SELECT rc.id_region FROM public.tb_region_city rc
                            WHERE rc.uf = $2::text
                              AND rc.municipio_norm = fl_norm_city($3::text)),
              taxonomy_declared_at = NOW(), updated_at = NOW()
        WHERE id_user = $4 AND is_user_account = TRUE`,
      [spec.id_category, spec.estado, spec.municipio, id_user],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const community = await CommunityService.create(
    { id_user },
    { ...spec.community, id_machine: spec.id_machine, kind: "common" },
  );
  if (community?.error) throw new Error(`Comunidade: ${community.error}`);
  await pool.query(
    `UPDATE public.tb_profile
        SET estado = $1::text, municipio = $2::text,
            id_region = (SELECT rc.id_region FROM public.tb_region_city rc
                          WHERE rc.uf = $1::text
                            AND rc.municipio_norm = fl_norm_city($2::text)),
            updated_at = NOW()
      WHERE id_profile = $3`,
    [spec.estado, spec.municipio, community.id_profile],
  );
  console.log(JSON.stringify({ id_user, id_community: community.id_profile }));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
