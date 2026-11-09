# src/utils — arquivos que NÃO se editam à mão

Estes são GERADOS a partir do TS do front (`features/meu-mundo/...`). Mudar aqui é sobrescrito; mude o TS e rode o script em `scripts/`, depois commite os dois repos (o `test:unit` confere a cópia):

| Gerado | Script | Fonte no front |
|---|---|---|
| `meuMundoFight.js` | `build-fight-sim.js` | `laminas/sim/` |
| `meuMundoPaint.js` | `build-paint-sim.js` | `paint/sim/` |
| `meuMundoCorrida.js` | `build-corrida-sim.js` | `corrida/sim/` |
| `meuMundoGincana.js` | `build-gincana-sim.js` | `gincana/sim/` |
| `meuMundoJetpackSim.js` | `build-jetpack-sim.js` | `jetpack/sim/` |
| `meuMundoNoturnoSim.js` | `build-noturno-sim.js` | `noturno/sim/` |
| `meuMundoPower.js` | `build-power-sim.js` | `power/` |
| `meuMundoCharacters.js` | `build-characters-sim.js` | `characters/` |

Regras do Meu Mundo que nascem AQUI e têm espelho no front (teste de espelho): `meuMundoLife.js` (vida, `gain()`, orçamento diário), `meuMundoLayout.js`, `meuMundoMotion.js`, `meuMundoHeights.js` ↔ `heights.ts`, `meuMundoSkins.js` ↔ `skins.ts`, `meuMundoColors.js` ↔ `avatar-colors.ts`, `meuMundoCenter.js` (planta; mudou → `CENTER_VERSION`). Detalhe: `features/meu-mundo/CLAUDE.md` do front.

Fontes únicas fora do jogo: `feedKind.js`, `feedReach.js`, `beeLife.js` (`BEE_ALIVE_SQL`), `communityPolicy.js`, `communitySite.js`, `spaceCaps.js`, `condoResidentSql.js`, `currency.js`, `aiAccess.js`, `aiQuota.js`, `bookingFee`, `profilePaywall.js`.
