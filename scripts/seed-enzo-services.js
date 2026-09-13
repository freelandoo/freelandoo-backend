/**
 * Cadastra os 6 serviços da barbearia do Enzo e a agenda dela.
 *
 * ── POR QUE ISTO EXISTE ──────────────────────────────────────────────────────
 * O site do Enzo tinha todos os botões no WhatsApp porque `links.booking` era
 * `null` — e ele é nulo quando não há NENHUM serviço reservável cadastrado
 * (`bookingFor`, em `lib/community-site.ts`). Sem os serviços, "Agendar"
 * levaria a um passo 1 vazio: um botão que gasta o clique de quem estava
 * decidido.
 *
 * ⚠️ PASSA PELO SERVICE, NUNCA POR SQL CRU. É ele que valida duração, preço e
 * posse do perfil — a mesma porta que a tela do dono usa. INSERT direto fura o
 * normalizador, e o sintoma só apareceria no dia em que o front tentasse
 * desenhar o que o backend nunca aceitaria (a lição da mig 238, quando as 10
 * páginas do site do Ricardo foram gravadas pelo `CommunitySiteService.save`).
 *
 * ⚠️ OS PREÇOS SÃO OS DO SITE, não números novos: eles saem do cardápio em
 * `content/services.ts` do tema, que é o que o cliente lê. Preço que diverge
 * entre a tabela e o agendamento é a reclamação que chega na cadeira.
 *
 * ⚠️ AS DURAÇÕES SÃO SUPOSIÇÃO NOSSA — o site nunca as informou (ele diz, de
 * propósito, que "depende do corte"). Elas existem porque a agenda precisa
 * saber quanto bloquear, e são editáveis numa tela. Se o Enzo corrigir, é lá.
 *
 * Idempotente: serviço com o mesmo nome não é recriado.
 *
 * Uso: node scripts/seed-enzo-services.js
 */
require("dotenv").config();

const pool = require("../src/databases");
const ProfileServiceService = require("../src/services/ProfileServiceService");
const BookingAvailabilityService = require("../src/services/BookingAvailabilityService");
const ProfileServiceStorage = require("../src/storages/ProfileServiceStorage");

/** Enzo Cortes — usuário e perfil-conta (o líder entra pelo perfil-conta). */
const ID_USER = "1047274e-25ef-40ca-9264-20e3a53d724b";
const ID_PROFILE = "1b13008c-648a-4c96-8b14-bd9a8604dcb6";

/** Preço em centavos; duração em minutos. */
const SERVICOS = [
  { name: "Corte", price_amount: 4000, duration_minutes: 30,
    description: "Degradê, social, na máquina ou na tesoura — o acabamento é combinado antes de a máquina ligar." },
  { name: "Barba", price_amount: 2500, duration_minutes: 30,
    description: "Desenho, alinhamento e acabamento — do aparado curto ao contorno de barba cheia." },
  { name: "Sobrancelha", price_amount: 1500, duration_minutes: 15,
    description: "Limpeza e alinhamento sem tirar o traço masculino." },
  { name: "Risco / desenho", price_amount: 500, duration_minutes: 15,
    description: "Do risco reto de um traço ao desenho trabalhado — a partir de R$ 5, o valor do seu é combinado antes de começar." },
  { name: "Corte + barba", price_amount: 6000, duration_minutes: 60,
    description: "Os dois no mesmo dia por R$ 60 — R$ 5 a menos do que pagando separado." },
  { name: "Corte + barba + sobrancelha", price_amount: 7000, duration_minutes: 75,
    description: "Os três de uma vez por R$ 70 — R$ 10 a menos do que avulsos." },
];

/**
 * Seg a sábado, 09h às 19h — exatamente o que o site anuncia
 * (`BUSINESS.hoursHuman`). Domingo fechado.
 *
 * ⚠️ SEM ISTO A AGENDA RESPONDERIA PELO PADRÃO (09:00–18:00, TODO DIA — ver
 * `utils/bookingDefaults`), e aí o site prometeria um horário que a página de
 * agendamento recusa: domingo apareceria livre e as 18h30 de sábado não.
 */
const ABERTURA = "09:00";
const FECHAMENTO = "19:00";
const PASSO_MINUTOS = 30;

async function main() {
  const user = { id_user: ID_USER };

  const existentes = await ProfileServiceStorage.list(pool, ID_PROFILE);
  const jaTem = new Set((existentes || []).map((s) => String(s.name).trim().toLowerCase()));
  console.log(`serviços já cadastrados: ${jaTem.size}`);

  let criados = 0;
  for (const s of SERVICOS) {
    if (jaTem.has(s.name.toLowerCase())) {
      console.log(`  = ${s.name} (já existe, pulando)`);
      continue;
    }
    const r = await ProfileServiceService.create(user, { id_profile: ID_PROFILE }, {
      ...s,
      is_active: true,
      price_on_request: false,
    });
    if (r.error) {
      console.log(`  ! ${s.name}: ${r.error}`);
      process.exitCode = 1;
    } else {
      criados++;
      console.log(`  + ${s.name} — R$ ${(s.price_amount / 100).toFixed(2)} · ${s.duration_minutes}min`);
    }
  }

  // Agenda: 1 = segunda … 6 = sábado; 0 = domingo, fechado.
  const rules = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    is_enabled: weekday !== 0,
    start_time: ABERTURA,
    end_time: FECHAMENTO,
    slot_duration_minutes: PASSO_MINUTOS,
    buffer_minutes: 0,
  }));
  const ag = await BookingAvailabilityService.saveWeeklyRules(user, { id_profile: ID_PROFILE }, { rules });
  console.log(ag.error ? `  ! agenda: ${ag.error}` : `  + agenda seg–sáb ${ABERTURA}–${FECHAMENTO}, passo de ${PASSO_MINUTOS}min`);

  // Intenção declarada do dono. Nada no fluxo de criação de reserva gateia por
  // isto hoje — mas é o que a tela dele mostra, e deixá-la em FALSE com a
  // agenda cheia seria a tela dizendo que o agendamento está desligado.
  const st = await BookingAvailabilityService.saveBookingSettings(
    user, { id_profile: ID_PROFILE }, { allow_booking: true }
  );
  console.log(st.error ? `  ! settings: ${st.error}` : `  + allow_booking = true`);

  console.log(`\n${criados} serviço(s) criado(s).`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
