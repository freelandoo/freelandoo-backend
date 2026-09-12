// Whitelist fechada das funções por usuário (mig 186) — fonte única, usada
// pelas rotas de preferência (userFeaturePref.routes) e pela Loja de Funções
// (FunctionStoreService). Chave fora daqui = 400. Onde a função também tem
// flag de admin, a chave é a MESMA (store, vaquinha, fitness_academias) pro
// front combinar os dois mapas sem tradução.
const USER_FEATURE_KEYS = [
  "courses",
  "store",
  "services",
  "vaquinha",
  "communities",
  "wallet",
  "fitness_academias",
  "profiles",
  "agenda",
  // WhatsApp (migs 223/225): NUNCA foi vendida avulsa — nasce dentro do plano
  // mensal, e por isso não tem linha em `tb_function_product`. O ownership
  // trata isso: chave em plano exige assinatura, com ou sem produto de vitrine.
  "whatsapp",
  // Plano NEGÓCIO (mig 234): o negócio e o site são de todos; estas três são as
  // PORTAS que o plano libera — aceitar membro, PUBLICAR o site (compartilhar)
  // e o atendente de IA incluído. Nunca vendidas avulsas (sem linha na Loja).
  "community_members",
  "site_share",
  "atendimento_ia",
  // Site feito pela Freelandoo (mig 241): o direito de ter um site GERENCIADO
  // no ar. Não abre porta de tela nenhuma — quem monta o site somos nós —, e é
  // por isso que ela existe: é a resposta de "ainda tem direito?" que a
  // carência lê antes de despublicar. Nunca vendida avulsa: linha na Loja com
  // `is_for_sale = FALSE` significaria GRÁTIS PARA TODO MUNDO.
  "managed_site",
  // "vitrine" é a única com efeito SERVER-SIDE: desligada, os perfis do user
  // somem da vitrine pública (SearchStorage) pra todo mundo — não é só UI.
  "vitrine",
];

module.exports = { USER_FEATURE_KEYS };
