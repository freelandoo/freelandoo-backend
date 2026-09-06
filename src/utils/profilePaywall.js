// Fonte única do PAYWALL DE PUBLICAÇÃO por perfil.
//
// A regra (Alex, 2026-09-06): o perfil ÚNICO da pessoa — o perfil-conta, o que
// carrega o rosto dela — publica de graça. Quem ADICIONA outro perfil paga por
// ele: perfil adicional só publica com assinatura ativa. É o que separa a CONTA
// (grátis, porque é a pessoa) do PERFIL COMPRADO (que é produto).
//
// ⚠️ QUEM RECUSA É A PORTA DE PUBLICAR, e é essa a correção que este arquivo
// existe para carregar. Até aqui o paywall morava só no SELECT do feed global
// (`PortfolioFeedStorage`): o post do perfil adicional era ACEITO, gravado,
// aparecia na comunidade e no perfil do autor — e sumia do /feed sem uma
// palavra. O autor escolhia "Feed geral" no composer e não recebia nem erro nem
// aviso. Cobrar escondendo depois é a forma mais cara de cobrar: o trabalho de
// gravar, cortar e subir a mídia já foi todo feito quando o silêncio começa.
//
// O gate do feed CONTINUA de pé como segunda linha — os posts que já entraram
// sob a regra antiga seguem fora do feed global, e uma porta de publicação nova
// que esqueça de chamar daqui não vaza conteúdo pago para o feed.
//
// Fora do paywall, de propósito:
//  • CLAN — entidade coletiva com regra própria: criar um JÁ exige assinatura
//    ativa (`ClanService`), então cobrar de novo aqui seria a segunda porta
//    dizendo a mesma coisa, e é assim que as duas passam a divergir.
//  • COMUNIDADE — mora na mesma tabela dos perfis (pet/carro/games/bairro/
//    condomínio são modalidades dela), mas nunca é AUTORA de post: quem publica
//    no mural é o perfil do membro. Conferido na base: zero itens e zero bees
//    de perfil de comunidade.

const PUBLISH_PAYWALL_ERROR = {
  error:
    "Este perfil precisa de assinatura ativa para publicar. O perfil da sua conta publica sem pagar.",
  statusCode: 402,
  needs_subscription: true,
};

// A pergunta do paywall em UMA linha de SQL, para quem já está montando query.
// Recebe o alias da tabela de perfil.
function canPublishSql(profileAlias = "p") {
  return `(
    ${profileAlias}.is_user_account = TRUE
    OR ${profileAlias}.is_clan = TRUE
    OR EXISTS (
      SELECT 1 FROM public.tb_profile_subscription s
       WHERE s.id_profile = ${profileAlias}.id_profile AND s.status = 'active'
    )
  )`;
}

// "Pago" no sentido de LOJA liberada: perfil-conta OU assinatura ativa
// (paridade user≡perfil 2026-07-19 — a conta vende sem assinatura, como a
// vitrine deixou de exigir pagamento). Mora aqui porque é a MESMA pergunta que
// o paywall de publicar faz; enquanto morou dentro do serviço de produtos, a
// porta de publicar não tinha como reusá-la e nasceu sem gate nenhum.
async function isProfilePaid(conn, id_profile) {
  const r = await conn.query(
    `SELECT 1 FROM public.tb_profile p
      WHERE p.id_profile = $1
        AND (
          p.is_user_account = TRUE
          OR EXISTS (
            SELECT 1 FROM public.tb_profile_subscription s
             WHERE s.id_profile = p.id_profile AND s.status = 'active'
          )
        )
      LIMIT 1`,
    [id_profile]
  );
  return r.rowCount > 0;
}

// Recusa pronta para a porta de publicar: devolve `null` quando pode publicar e
// o erro 402 quando não pode. Perfil inexistente devolve `null` de propósito —
// quem responde por "esse perfil não existe" ou "não é seu" é o guard de posse
// de cada porta, e responder aqui trocaria o motivo certo por um errado.
async function assertProfileCanPublish(conn, id_profile) {
  const r = await conn.query(
    `SELECT ${canPublishSql("p")} AS can_publish
       FROM public.tb_profile p
      WHERE p.id_profile = $1
      LIMIT 1`,
    [id_profile]
  );
  if (!r.rowCount) return null;
  return r.rows[0].can_publish ? null : { ...PUBLISH_PAYWALL_ERROR };
}

module.exports = {
  PUBLISH_PAYWALL_ERROR,
  canPublishSql,
  isProfilePaid,
  assertProfileCanPublish,
};
