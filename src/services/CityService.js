// src/services/CityService.js
//
// MINHA CIDADE (mig 468) — a entrada comum de Meu bairro e Meu condomínio.
//
// Este service NÃO é dono de nada territorial: ele só responde, numa
// requisição, "qual moradia a pessoa escolheu" e "que vínculos ela já tem".
// Os vínculos vêm das MESMAS consultas que já desenham o bairro
// (`NeighborhoodStorage.listMine`) e o menu da foto
// (`SubjectCommunityStorage.listMySpaces`) — uma terceira definição de "meu
// condomínio" faria a aba e o menu discordarem.
//
// ⚠️ Nada aqui autoriza. A tela usa a resposta para ESCOLHER o que mostrar; o
// que cada aba pode fazer é decidido pelas rotas da comunidade, da residência
// e do delivery, como sempre.

const pool = require("../databases");
const CityPrefStorage = require("../storages/CityPrefStorage");
const NeighborhoodStorage = require("../storages/NeighborhoodStorage");
const SubjectCommunityStorage = require("../storages/SubjectCommunityStorage");
const { normalizeCityPrefInput, mergeBairros } = require("../utils/cityPref");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CityService");

function projectPref(row) {
  return {
    housing_kind: row?.housing_kind || null,
    last_tab: row?.last_tab || null,
  };
}

class CityService {
  static async getMine(user) {
    return runWithLogs(log, "getMine", () => ({ id_user: user?.id_user }), async () => {
      const id_user = user?.id_user;
      if (!id_user) return { error: "Usuário não autenticado.", statusCode: 401 };

      const [pref, residenceRows, spaces] = await Promise.all([
        CityPrefStorage.get(pool, id_user),
        NeighborhoodStorage.listMine(pool, id_user),
        SubjectCommunityStorage.listMySpaces(pool, id_user),
      ]);

      const hoodMemberships = spaces.filter((s) => s.kind === "neighborhood");
      const condos = spaces
        .filter((s) => s.kind === "condo")
        .map((s) => ({
          id_profile: s.id_profile,
          display_name: s.display_name || null,
          avatar_url: s.avatar_url || null,
          role: s.role || null,
        }));

      return {
        preference: projectPref(pref),
        bairros: mergeBairros(residenceRows, hoodMemberships),
        condos,
      };
    });
  }

  static async setMine(user, body) {
    return runWithLogs(log, "setMine", () => ({ id_user: user?.id_user }), async () => {
      const id_user = user?.id_user;
      if (!id_user) return { error: "Usuário não autenticado.", statusCode: 401 };
      const parsed = normalizeCityPrefInput(body);
      if (parsed.error) return { error: parsed.error, statusCode: 400 };
      const row = await CityPrefStorage.upsert(pool, id_user, parsed.value);
      return { preference: projectPref(row) };
    });
  }
}

module.exports = CityService;
