// Versão atual dos Termos de Uso / Política de Privacidade aceitos no cadastro.
// O aceite é gravado em tb_user_action_consent (mig 129) sob a ação "signup".
// Subir este número re-dispara a tela de aceite (/aceitar-termos) para TODOS os
// usuários no próximo login — útil quando os termos mudam de versão.
const SIGNUP_TERMS_VERSION = 1;
const SIGNUP_ACTION_KEY = "signup";

module.exports = { SIGNUP_TERMS_VERSION, SIGNUP_ACTION_KEY };
