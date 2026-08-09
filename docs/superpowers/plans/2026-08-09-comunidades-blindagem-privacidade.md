# Blindagem de privacidade das comunidades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os quatro vazamentos de privacidade das comunidades (C1–C4 do desenho macro) introduzindo uma fonte única de política de exposição por modalidade e uma projeção por audiência com negação por padrão.

**Architecture:** Um módulo puro (`src/utils/communityPolicy.js`) declara, por modalidade, qual tier de viewer pode ver o quê. `CommunityService` resolve o tier uma vez por requisição e passa toda leitura pela projeção — campo não liberado para aquele tier **não existe** no objeto de saída. Nenhuma migration, nenhuma mudança de modelo de dados. É o Subsistema 1 da §14 do spec e não depende de nenhum outro.

**Tech Stack:** Node 24 · Express 5 · PostgreSQL puro (`pg`, sem ORM) · `node:test` (runner nativo, zero dependência nova) · Next.js 16 no frontend.

**Spec:** `docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md` (§5 fronteiras de autorização, §11 ameaças).

---

## Contexto que o executor precisa saber

**Convenções do projeto (não negociáveis):**
- Camadas: `routes/` → `controllers/` → `services/` → `storages/` (SQL puro).
- Service devolve `{ error: "msg", statusCode: N }`; `sendServiceResult` traduz para HTTP. **`statusCode` é o campo lido — `status` seria ignorado.**
- Todo método de service é embrulhado em `runWithLogs(log, op, () => meta, async () => {...})`.
- Frontend fica em `../freelandoo frontend/freelandoo-website-main/` (**path com espaço — sempre entre aspas**). É um repo git **separado**.
- **Nunca** `git add -A` no frontend: há WIP paralelo. Commitar só os caminhos citados.
- No backend há WIP não relacionado no working tree (`src/controllers/AdminUsersController.js`, `src/routes/adminUsers.routes.js`, `src/storages/AdminUsersStorage.js`) — **não commitar esses arquivos**.
- Sem `border-radius` em UI nova (regra `.fl-sharp`).

**O que existe hoje e vai mudar:**

| Vazamento | Onde | Comportamento atual |
|---|---|---|
| C1 | `CommunityStorage.listPublic` / `getById` | Devolvem `member_count`, `xp_total`, `xp_level` para qualquer visitante, inclusive condomínio |
| C2 | `GET /communities/:id/goal` | **Sem middleware de auth**; `_assembleGoal` devolve nome, username, avatar e nível de até 20 membros |
| C3 | `CommunityService.getMembers` | Só condomínio tem gate; comunidade privada paga entrega a lista a qualquer um |
| C4 | `CommunityStorage.listPublic` | `ILIKE` em `p.condo_street` permite enumerar endereços |

**Modalidades e o vocabulário do banco:** `tb_profile.community_kind ∈ {'common','academy','condo'}` e `tb_profile.community_privacy ∈ {'public','private'}`. Nas leituras eles chegam com alias: `kind` e `privacy` (ver `CommunityStorage.getById`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| **Criar** `src/utils/communityPolicy.js` | Fonte única: escada de tiers, política por modalidade, resolução de tier e projeção. Puro — sem I/O, sem `require` de storage |
| **Criar** `test/unit/communityPolicy.test.js` | Testes unitários do módulo acima (`node:test`) |
| **Criar** `test/community-privacy.e2e.js` | Smoke pelos services contra Postgres de teste (padrão já usado nas entregas recentes) |
| **Modificar** `src/storages/CommunityStorage.js` | Tirar `condo_street` do `ILIKE` (C4) |
| **Modificar** `src/services/CommunityService.js` | `listPublic`, `getById`, `getMembers`, `getBenchmark`, `getGoal` passam pela política |
| **Modificar** `src/controllers/CommunityController.js` | Repassar `req.user` para `listPublic`, `getBenchmark`, `getGoal` |
| **Modificar** `src/routes/communityPublic.routes.js` | `optionalAuthMiddleware` em `/`, `/:id/goal`, `/:id/benchmark` |
| **Modificar** `package.json` | Script `test:unit` |
| **Modificar** (frontend) `components/community/community-tile.tsx` | Contadores viram opcionais |
| **Modificar** (frontend) `app/(header-only)/comunidades/[id]/page.tsx` | Contadores opcionais + token nas chamadas de goal/benchmark |
| **Modificar** (frontend) `app/(header-only)/comunidades/[id]/_components/condo-view.tsx` | Contador opcional |

---

## Task 1: Módulo de política de modalidade

**Files:**
- Create: `src/utils/communityPolicy.js`
- Test: `test/unit/communityPolicy.test.js`
- Modify: `package.json` (script `test:unit`)

- [ ] **Step 1: Adicionar o script de teste unitário**

Em `package.json`, dentro de `"scripts"`, logo abaixo da linha `"test": "echo No automated tests yet && exit 0",`, acrescentar:

```json
    "test:unit": "node --test test/unit",
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `test/unit/communityPolicy.test.js`:

```js
// test/unit/communityPolicy.test.js
const test = require("node:test");
const assert = require("node:assert");

const {
  TIER,
  policyFor,
  resolveTier,
  can,
  projectCommunity,
  COUNTER_FIELDS,
} = require("../../src/utils/communityPolicy");

test("policyFor: condomínio é territorial, independente de privacy", () => {
  assert.strictEqual(policyFor({ kind: "condo", privacy: "public" }).id, "territorial");
  assert.strictEqual(policyFor({ kind: "condo", privacy: "private" }).id, "territorial");
});

test("policyFor: temática pública x privada", () => {
  assert.strictEqual(policyFor({ kind: "common", privacy: "public" }).id, "thematic_public");
  assert.strictEqual(policyFor({ kind: "common", privacy: "private" }).id, "thematic_private");
});

test("policyFor: modalidade desconhecida cai no mais restrito", () => {
  assert.strictEqual(policyFor({ kind: "surpresa", privacy: "public" }).id, "territorial");
  assert.strictEqual(policyFor(null).id, "territorial");
});

test("resolveTier: escada completa", () => {
  assert.strictEqual(resolveTier({}), TIER.anonymous);
  assert.strictEqual(resolveTier({ viewer: { id_user: "u1" } }), TIER.outsider);
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "member" } }),
    TIER.member,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "member" }, isResident: true }),
    TIER.resident,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "vice" } }),
    TIER.manager,
  );
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "leader" } }),
    TIER.manager,
  );
});

test("resolveTier: gestor vence morador", () => {
  assert.strictEqual(
    resolveTier({ viewer: { id_user: "u1" }, membership: { role: "leader" }, isResident: true }),
    TIER.manager,
  );
});

test("can: negação por padrão para recurso desconhecido", () => {
  const policy = policyFor({ kind: "common", privacy: "public" });
  assert.strictEqual(can(policy, "recurso_inexistente", TIER.manager), false);
});

test("can: temática pública libera tudo para anônimo", () => {
  const policy = policyFor({ kind: "common", privacy: "public" });
  for (const r of ["counters", "memberList", "goal", "benchmark"]) {
    assert.strictEqual(can(policy, r, TIER.anonymous), true, r);
  }
});

test("can: temática privada exige membro", () => {
  const policy = policyFor({ kind: "common", privacy: "private" });
  assert.strictEqual(can(policy, "memberList", TIER.outsider), false);
  assert.strictEqual(can(policy, "memberList", TIER.member), true);
  assert.strictEqual(can(policy, "goal", TIER.outsider), false);
  assert.strictEqual(can(policy, "goal", TIER.member), true);
});

test("can: territorial exige morador para lista e metas, membro para contadores", () => {
  const policy = policyFor({ kind: "condo", privacy: "public" });
  assert.strictEqual(can(policy, "counters", TIER.outsider), false);
  assert.strictEqual(can(policy, "counters", TIER.member), true);
  assert.strictEqual(can(policy, "memberList", TIER.member), false);
  assert.strictEqual(can(policy, "memberList", TIER.resident), true);
  assert.strictEqual(can(policy, "memberList", TIER.manager), true);
  assert.strictEqual(can(policy, "goal", TIER.member), false);
  assert.strictEqual(can(policy, "goal", TIER.resident), true);
});

test("projectCommunity: forasteiro em condomínio não recebe contadores", () => {
  const row = {
    id_profile: "p1",
    kind: "condo",
    privacy: "public",
    display_name: "Ed. Aurora",
    member_count: 42,
    xp_total: 999,
    xp_level: 7,
  };
  const out = projectCommunity(row, TIER.outsider);
  for (const f of COUNTER_FIELDS) {
    assert.strictEqual(f in out, false, `${f} vazou`);
  }
  assert.strictEqual(out.display_name, "Ed. Aurora");
});

test("projectCommunity: membro de condomínio recebe contadores", () => {
  const row = { id_profile: "p1", kind: "condo", privacy: "public", member_count: 42, xp_total: 9, xp_level: 1 };
  const out = projectCommunity(row, TIER.member);
  assert.strictEqual(out.member_count, 42);
});

test("projectCommunity: temática pública mantém contadores para anônimo", () => {
  const row = { id_profile: "p1", kind: "common", privacy: "public", member_count: 42, xp_total: 9, xp_level: 1 };
  const out = projectCommunity(row, TIER.anonymous);
  assert.strictEqual(out.member_count, 42);
  assert.strictEqual(out.xp_level, 1);
});

test("projectCommunity: não muta a linha original", () => {
  const row = { id_profile: "p1", kind: "condo", privacy: "public", member_count: 42 };
  projectCommunity(row, TIER.outsider);
  assert.strictEqual(row.member_count, 42);
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../../src/utils/communityPolicy'`

- [ ] **Step 4: Implementar o módulo**

Criar `src/utils/communityPolicy.js`:

```js
// src/utils/communityPolicy.js
// Fonte ÚNICA da política de exposição das comunidades.
//
// Antes deste módulo a regra de privacidade era o literal
// `privacy === 'private' || kind === 'condo'` repetido em vários guards — e foi
// exatamente assim que os vazamentos C2 e C3 nasceram: alguém escreveu um guard
// novo e esqueceu do OR. Aqui a modalidade declara o que expõe, e a projeção
// nega por padrão: campo não liberado para o tier NÃO EXISTE na saída.
//
// Módulo puro: sem I/O, sem require de storage. É o que o torna testável e o que
// permite reusá-lo em qualquer camada.
//
// Spec: docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §5

// Escada de tiers. Comparação é numérica: tier >= mínimo exigido.
const TIER = Object.freeze({
  anonymous: 0,
  outsider: 1, // logado, sem vínculo com esta comunidade
  member: 2, // entrou na comunidade
  resident: 3, // titular de unidade confirmada (condomínio)
  manager: 4, // leader | vice
  platform_admin: 5,
});

// Campos de contagem/atividade. São os que denunciam o tamanho e o movimento
// interno da comunidade — o que a visão proíbe expor em modalidade territorial.
const COUNTER_FIELDS = Object.freeze(["member_count", "xp_total", "xp_level"]);

const THEMATIC_PUBLIC = Object.freeze({
  id: "thematic_public",
  searchableByAddress: false,
  minTier: Object.freeze({
    counters: TIER.anonymous,
    memberList: TIER.anonymous,
    goal: TIER.anonymous,
    benchmark: TIER.anonymous,
  }),
});

const THEMATIC_PRIVATE = Object.freeze({
  id: "thematic_private",
  searchableByAddress: false,
  minTier: Object.freeze({
    counters: TIER.member,
    memberList: TIER.member,
    goal: TIER.member,
    benchmark: TIER.member,
  }),
});

// Bairro entrará aqui junto do condomínio quando o Subsistema 4 chegar.
const TERRITORIAL = Object.freeze({
  id: "territorial",
  searchableByAddress: false,
  minTier: Object.freeze({
    counters: TIER.member,
    memberList: TIER.resident,
    goal: TIER.resident,
    benchmark: TIER.resident,
  }),
});

const TERRITORIAL_KINDS = new Set(["condo"]);

/**
 * Política da comunidade. Modalidade desconhecida cai na MAIS RESTRITIVA de
 * propósito: se alguém adicionar um kind novo e esquecer de mapeá-lo aqui, o
 * efeito é esconder demais — nunca vazar.
 */
function policyFor(community) {
  const kind = community?.kind ?? null;
  const privacy = community?.privacy ?? null;
  if (kind === "common") {
    return privacy === "private" ? THEMATIC_PRIVATE : THEMATIC_PUBLIC;
  }
  if (TERRITORIAL_KINDS.has(kind)) return TERRITORIAL;
  return TERRITORIAL;
}

/**
 * Resolve o tier do viewer uma vez, a partir de fatos já carregados.
 * Gestor vence morador (quem lidera enxerga tudo que o morador enxerga).
 */
function resolveTier({ viewer, membership, isResident, isPlatformAdmin } = {}) {
  if (isPlatformAdmin) return TIER.platform_admin;
  const role = membership?.role ?? null;
  if (role === "leader" || role === "vice") return TIER.manager;
  if (isResident) return TIER.resident;
  if (membership) return TIER.member;
  if (viewer?.id_user) return TIER.outsider;
  return TIER.anonymous;
}

/** Negação por padrão: recurso não declarado na política é sempre negado. */
function can(policy, resource, tier) {
  const min = policy?.minTier?.[resource];
  if (typeof min !== "number") return false;
  return Number(tier) >= min;
}

/** Cópia sem os campos de contagem. Nunca muta a linha original. */
function stripCounters(row) {
  const out = { ...row };
  for (const field of COUNTER_FIELDS) delete out[field];
  return out;
}

/**
 * Recorta a comunidade para o tier do viewer. Toda leitura pública passa por
 * aqui — é a rede de segurança que torna o vazamento impossível por omissão.
 */
function projectCommunity(row, tier) {
  if (!row) return row;
  const policy = policyFor(row);
  if (can(policy, "counters", tier)) return { ...row };
  return stripCounters(row);
}

module.exports = {
  TIER,
  COUNTER_FIELDS,
  policyFor,
  resolveTier,
  can,
  stripCounters,
  projectCommunity,
};
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm run test:unit`
Expected: PASS — 13 testes, `# fail 0`

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros e sem warnings (o eslint roda com `--max-warnings 0`)

- [ ] **Step 7: Commit**

```bash
git add src/utils/communityPolicy.js test/unit/communityPolicy.test.js package.json
git commit -m "feat(comunidades): política de modalidade e projeção por audiência (fonte única)"
```

---

## Task 2: Tirar a rua da busca pública (C4)

**Files:**
- Modify: `src/storages/CommunityStorage.js` (bloco `listPublic`, ~linha 256)

- [ ] **Step 1: Substituir o filtro de texto**

Em `src/storages/CommunityStorage.js`, dentro de `listPublic`, trocar o bloco `if (q) { ... }` inteiro por:

```js
    if (q) {
      params.push(`%${q}%`);
      // Condomínio é achável por NOME, BAIRRO e CIDADE — nunca por RUA.
      // Buscar por logradouro permitia enumerar endereços (C4 do desenho macro):
      // bastava digitar uma rua para descobrir o que existe nela.
      where.push(
        `(p.display_name ILIKE $${params.length}
          OR (p.community_kind = 'condo' AND (
                p.condo_neighborhood ILIKE $${params.length}
             OR p.municipio          ILIKE $${params.length})))`
      );
    }
```

E atualizar o comentário do cabeçalho do método, logo acima de `static async listPublic`, para:

```js
  // kind: 'common' | 'academy' | 'condo' | null (todas). Condomínio é
  // pesquisável por NOME, BAIRRO ou CIDADE — nunca por rua (C4). A lista
  // pública também não devolve rua/número/CEP: isso só sai no getById para
  // membro confirmado/administrador.
```

- [ ] **Step 2: Verificar que nenhuma outra query busca por logradouro**

Run: `grep -rn "condo_street" src/`
Expected: apenas `src/storages/CommunityStorage.js` (SELECT do `getById`), `src/utils/condoRules.js` e `src/storages/CondoStorage.js` — **nenhuma ocorrência dentro de um `ILIKE` ou `WHERE`**

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/storages/CommunityStorage.js
git commit -m "fix(comunidades): busca não aceita mais logradouro de condomínio (C4)"
```

---

## Task 3: Projetar a listagem pública (C1)

**Files:**
- Modify: `src/services/CommunityService.js` (`listPublic`, ~linha 276)
- Modify: `src/controllers/CommunityController.js` (`listPublic`, ~linha 54)
- Modify: `src/routes/communityPublic.routes.js` (rota `/`, linha 9)

- [ ] **Step 1: Importar o módulo de política no service**

No topo de `src/services/CommunityService.js`, junto dos outros `require`, acrescentar:

```js
const CommunityPolicy = require("../utils/communityPolicy");
```

- [ ] **Step 2: Reescrever `listPublic` no service**

Substituir o método `listPublic` inteiro por:

```js
  // A listagem é pública, mas o RECORTE depende do viewer: contadores de
  // comunidade privada e de condomínio só saem para quem já é de dentro.
  // Uma consulta só resolve o vínculo do viewer com TODAS as comunidades dele
  // (listForUser) — não há N+1 aqui.
  static async listPublic(query, viewer) {
    return runWithLogs(
      log,
      "listPublic",
      () => ({ q: query?.q, viewer: viewer?.id_user ? "auth" : "anon" }),
      async () => {
        const communities = await CommunityStorage.listPublic(pool, {
          q: query?.q,
          id_machine: query?.id_machine,
          id_region: query?.id_region,
          kind: COMMUNITY_KINDS.includes(query?.kind) ? query.kind : null,
          limit: query?.limit,
          offset: query?.offset,
        });

        const roleByCommunity = new Map();
        if (viewer?.id_user) {
          const mine = await CommunityStorage.listForUser(pool, viewer.id_user);
          for (const row of mine) {
            roleByCommunity.set(String(row.id_profile), row.role);
          }
        }

        // Morador não é resolvido aqui: na listagem o único recurso em jogo é
        // `counters`, cujo mínimo é `member` — resolver residência por linha
        // custaria duas queries por card sem mudar nenhuma decisão.
        const projected = communities.map((row) => {
          const role = roleByCommunity.get(String(row.id_profile)) || null;
          const tier = CommunityPolicy.resolveTier({
            viewer,
            membership: role ? { role } : null,
          });
          return CommunityPolicy.projectCommunity(row, tier);
        });

        return { communities: projected };
      }
    );
  }
```

- [ ] **Step 3: Repassar o viewer no controller**

Em `src/controllers/CommunityController.js`, substituir o método `listPublic` por:

```js
  static async listPublic(req, res) {
    const result = await CommunityService.listPublic(req.query, req.user);
    return sendServiceResult(res, result);
  }
```

- [ ] **Step 4: Anexar o viewer na rota**

Em `src/routes/communityPublic.routes.js`, substituir a linha 9 por:

```js
// Auth opcional: a lista é pública, mas o recorte depende do viewer — membro
// vê os contadores da própria comunidade privada/condomínio; forasteiro não.
router.get("/", optionalAuthMiddleware, asyncHandler(CommunityController.listPublic));
```

- [ ] **Step 5: Verificar que o módulo é o único caminho**

Run: `grep -n "member_count" src/services/CommunityService.js`
Expected: nenhuma ocorrência (o service não monta contador à mão; ele vem do storage e é recortado pela projeção)

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 7: Commit**

```bash
git add src/services/CommunityService.js src/controllers/CommunityController.js src/routes/communityPublic.routes.js
git commit -m "fix(comunidades): listagem pública não expõe contadores de privada/condomínio (C1)"
```

---

## Task 4: Projetar o `getById` (C1)

**Files:**
- Modify: `src/services/CommunityService.js` (`getById`, ~linha 156)

- [ ] **Step 1: Reescrever `getById`**

Substituir o método `getById` inteiro por:

```js
  // viewer (opcional) resolve membership/assinatura — a página precisa saber se
  // mostra o feed ou a trava de comunidade privada. O tier resolvido aqui é o
  // mesmo que recorta a saída: nada de decidir permissão em dois lugares.
  static async getById(params, viewer) {
    return runWithLogs(
      log,
      "getById",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const community = await CommunityStorage.getById(
          pool,
          params.id_profile
        );
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        let membership = null;
        let viewer_sub_status = null;
        if (viewer?.id_user) {
          membership = await CommunityStorage.getMembership(pool, params.id_profile, viewer.id_user);
          const sub = await CommunityStorage.getLiveMemberSub(pool, params.id_profile, viewer.id_user);
          viewer_sub_status = sub ? sub.status : null;
        }
        const viewer_membership = membership ? membership.role : null;
        const isAdmin = viewer_membership === "leader" || viewer_membership === "vice";

        // Condomínio: endereço de rua e situação de moradia só para quem tem
        // direito. Visitante enxerga bairro/cidade/UF (é assim que ele acha o
        // prédio na busca) e nada mais.
        if (community.kind === "condo") {
          const resident = viewer?.id_user
            ? await CondoStorage.getResidentStatus(pool, params.id_profile, viewer.id_user)
            : null;
          const tier = CommunityPolicy.resolveTier({
            viewer,
            membership,
            isResident: !!resident?.confirmed,
          });
          const canSeeAddress = isAdmin || !!resident?.confirmed;
          const base = CondoRules.stripAddressColumns(community);
          return {
            community: {
              ...CommunityPolicy.projectCommunity(base, tier),
              address: canSeeAddress
                ? CondoRules.fullAddress(community)
                : CondoRules.publicAddress(community),
              address_is_full: canSeeAddress,
              viewer_is_member: !!viewer_membership,
              viewer_role: viewer_membership,
              viewer_sub_status,
              viewer_is_admin: isAdmin,
              viewer_is_resident: !!resident?.confirmed,
              viewer_has_pending_claim: !!resident?.pending,
              viewer_units: resident?.units || [],
              viewer_parking: resident?.parking || [],
            },
          };
        }

        const tier = CommunityPolicy.resolveTier({ viewer, membership });
        return {
          community: {
            ...CommunityPolicy.projectCommunity(community, tier),
            viewer_is_member: !!viewer_membership,
            viewer_role: viewer_membership,
            viewer_sub_status,
          },
        };
      }
    );
  }
```

> **Nota para quem executa:** os campos `viewer_*` são adicionados **depois** da projeção de propósito. Eles descrevem o próprio viewer, não a comunidade — não são dado alheio e não podem ser recortados.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/services/CommunityService.js
git commit -m "fix(comunidades): getById recorta contadores por tier do viewer (C1)"
```

---

## Task 5: Gate na lista de membros (C3)

**Files:**
- Modify: `src/services/CommunityService.js` (`getMembers`, ~linha 297)

- [ ] **Step 1: Reescrever `getMembers`**

Substituir o método `getMembers` inteiro por:

```js
  // Saber QUEM está dentro é o dado mais sensível da comunidade. O tier mínimo
  // vem da política: temática pública libera; temática privada exige membro;
  // territorial exige morador confirmado (ou a administração).
  static async getMembers(params, viewer) {
    return runWithLogs(
      log,
      "getMembers",
      () => ({ id_profile: params?.id_profile, viewer: viewer?.id_user ? "auth" : "anon" }),
      async () => {
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        const membership = viewer?.id_user
          ? await CommunityStorage.getMembership(pool, params.id_profile, viewer.id_user)
          : null;
        const isAdmin = membership?.role === "leader" || membership?.role === "vice";

        const resident =
          community.kind === "condo" && viewer?.id_user
            ? await CondoStorage.getResidentStatus(pool, params.id_profile, viewer.id_user)
            : null;

        const policy = CommunityPolicy.policyFor(community);
        const tier = CommunityPolicy.resolveTier({
          viewer,
          membership,
          isResident: !!resident?.confirmed,
        });

        if (!CommunityPolicy.can(policy, "memberList", tier)) {
          return {
            error:
              community.kind === "condo"
                ? "Somente moradores do condomínio veem esta lista."
                : "Somente membros da comunidade veem esta lista.",
            statusCode: 403,
          };
        }

        if (community.kind === "condo") {
          // Morador vê os vizinhos; a unidade de cada um só aparece para o
          // administrador (o morador comum vê nome, não onde a pessoa mora).
          const members = await CondoStorage.listResidents(pool, params.id_profile, {
            with_units: isAdmin,
          });
          return { members };
        }

        const members = await CommunityStorage.listMembers(pool, params.id_profile);
        return { members };
      }
    );
  }
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/services/CommunityService.js
git commit -m "fix(comunidades): lista de membros de comunidade privada exige membro (C3)"
```

---

## Task 6: Fechar `/goal` e `/benchmark` (C2)

**Files:**
- Modify: `src/services/CommunityService.js` (`getBenchmark` ~linha 742, `getGoal` ~linha 826)
- Modify: `src/controllers/CommunityController.js` (~linhas 151 e 156)
- Modify: `src/routes/communityPublic.routes.js` (~linhas 29 e 33)

- [ ] **Step 1: Guard reutilizável no service**

Em `src/services/CommunityService.js`, logo **acima** de `static async getBenchmark`, inserir:

```js
  // Guard de leitura por política. Devolve { community } quando liberado, ou
  // { error, statusCode } quando não. Usado por /goal e /benchmark, que até o
  // desenho macro respondiam sem nenhuma autenticação (C2).
  static async _assertCanRead(id_community, viewer, resource) {
    const community = await CommunityStorage.getById(pool, id_community);
    if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

    const membership = viewer?.id_user
      ? await CommunityStorage.getMembership(pool, id_community, viewer.id_user)
      : null;
    const resident =
      community.kind === "condo" && viewer?.id_user
        ? await CondoStorage.getResidentStatus(pool, id_community, viewer.id_user)
        : null;

    const policy = CommunityPolicy.policyFor(community);
    const tier = CommunityPolicy.resolveTier({
      viewer,
      membership,
      isResident: !!resident?.confirmed,
    });
    if (!CommunityPolicy.can(policy, resource, tier)) {
      return { error: "Conteúdo restrito aos membros desta comunidade.", statusCode: 403 };
    }
    return { community };
  }
```

- [ ] **Step 2: Aplicar o guard em `getBenchmark`**

Substituir o método `getBenchmark` inteiro por:

```js
  // ─── Benchmark ────────────────────────────────────────────────────────────────
  static async getBenchmark(params, viewer) {
    return runWithLogs(
      log,
      "getBenchmark",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const gate = await this._assertCanRead(params.id_profile, viewer, "benchmark");
        if (gate.error) return gate;

        const benchmark = await CommunityStorage.getBenchmark(pool, params.id_profile);
        if (!benchmark) return { error: "Comunidade não encontrada", statusCode: 404 };
        const percentile =
          benchmark.total > 0
            ? Math.max(1, Math.round((benchmark.position / benchmark.total) * 100))
            : null;
        return { benchmark: { ...benchmark, percentile } };
      }
    );
  }
```

- [ ] **Step 3: Aplicar o guard em `getGoal`**

Substituir o método `getGoal` inteiro por:

```js
  static async getGoal(params, viewer) {
    return runWithLogs(
      log,
      "getGoal",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const gate = await this._assertCanRead(params.id_profile, viewer, "goal");
        if (gate.error) return gate;

        const goal = await CommunityStorage.getActiveGoalRow(pool, params.id_profile);
        if (!goal) return { goal: null };

        const now = Date.now();
        const endsTs = goal.ends_at ? new Date(goal.ends_at).getTime() : null;
        const due = goal.status === "active" && endsTs && endsTs < now;
        // Mede até agora (temporada viva) ou até o fim (encerrada).
        const asOf = endsTs && endsTs < now ? goal.ends_at : new Date().toISOString();
        const ranking = await CommunityStorage.getGoalRanking(pool, goal, asOf);

        if (due) {
          await this._closeAndPay(goal, ranking);
          const refreshed = await CommunityStorage.getActiveGoalRow(pool, params.id_profile);
          return { goal: this._assembleGoal(refreshed || goal, ranking) };
        }
        return { goal: this._assembleGoal(goal, ranking) };
      }
    );
  }
```

- [ ] **Step 4: Repassar o viewer no controller**

Em `src/controllers/CommunityController.js`, substituir os dois métodos:

```js
  static async getBenchmark(req, res) {
    const result = await CommunityService.getBenchmark(req.params, req.user);
    return sendServiceResult(res, result);
  }

  static async getGoal(req, res) {
    const result = await CommunityService.getGoal(req.params, req.user);
    return sendServiceResult(res, result);
  }
```

- [ ] **Step 5: Anexar o viewer nas rotas**

Em `src/routes/communityPublic.routes.js`, substituir os dois blocos de rota por:

```js
// Auth opcional: benchmark e metas expõem posição e RANKING NOMINAL de membros —
// em privada/condomínio isso é a lista de quem está dentro (C2 do desenho macro).
router.get(
  "/:id_profile/benchmark",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getBenchmark)
);
router.get(
  "/:id_profile/goal",
  optionalAuthMiddleware,
  asyncHandler(CommunityController.getGoal)
);
```

- [ ] **Step 6: Confirmar que nenhuma rota pública ficou sem viewer**

Run: `grep -n "router.get" src/routes/communityPublic.routes.js`
Expected: **toda** rota `GET` listada tem `optionalAuthMiddleware` — exceto nenhuma. A única rota sem ele deve ser o `POST /:id_profile/share-return`, que é público por contrato e não devolve dado da comunidade.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 8: Commit**

```bash
git add src/services/CommunityService.js src/controllers/CommunityController.js src/routes/communityPublic.routes.js
git commit -m "fix(comunidades): /goal e /benchmark exigem tier mínimo (C2)"
```

---

## Task 7: Smoke e2e pelos services

**Files:**
- Create: `test/community-privacy.e2e.js`
- Modify: `package.json` (script `test:privacy`)

Segue o padrão já usado nas entregas recentes (chamar os services direto contra um Postgres de teste), e não a suíte de checkout (que sobe servidor e fala com a Stripe).

- [ ] **Step 1: Adicionar o script**

Em `package.json`, logo abaixo de `"test:checkout"`, acrescentar:

```json
    "test:privacy": "node test/community-privacy.e2e.js",
```

- [ ] **Step 2: Escrever a suíte**

Criar `test/community-privacy.e2e.js`:

```js
// test/community-privacy.e2e.js — Subsistema 1: blindagem de privacidade.
//
//   npm run test:privacy
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
//   docker run -d --name fl-test-pg -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=freelandoo_test -p 55432:5432 postgres:16-alpine
//
// O que ela cobre, chamando os SERVICES direto (sem HTTP, sem Stripe):
//   1. listagem pública não devolve contadores de privada nem de condomínio;
//   2. temática pública segue devolvendo contadores para anônimo;
//   3. membro vê os contadores da própria comunidade;
//   4. busca por rua NÃO acha o condomínio; busca por bairro acha;
//   5. /members de privada recusa forasteiro e libera membro;
//   6. /members de condomínio recusa membro-não-morador e libera morador;
//   7. /goal recusa anônimo e forasteiro em privada e em condomínio;
//   8. /goal segue aberto em temática pública.

require("dotenv").config();

const assert = require("node:assert");
const { Client } = require("pg");

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";

if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function main() {
  const { execFileSync } = require("node:child_process");
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: require("node:path").join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });

  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const CondoStorage = require("../src/storages/CondoStorage");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;

  // ─── fixtures ────────────────────────────────────────────────────────────
  const { rows: machines } = await db.query(
    `SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`
  );
  const id_machine = machines[0].id_machine;

  async function mkUser(tag) {
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
            VALUES ($1, $2, 'x', $3, TRUE)
         RETURNING id_user`,
      [`User ${tag}`, `${mk(tag)}@ex.com`, mk(tag)]
    );
    return r.rows[0].id_user;
  }

  // Usa a storage REAL de criação: tb_profile tem colunas NOT NULL derivadas
  // (sub_profile_slug) que um INSERT cru quebraria, e assim o teste exercita o
  // mesmo caminho da aplicação.
  async function mkCommunity(owner, { kind, privacy, name }) {
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: owner,
      id_machine,
      display_name: name,
      bio: null,
      avatar_url: null,
      theme: null,
      kind,
      address: {
        street: "Rua Secreta",
        number: "100",
        complement: null,
        neighborhood: "Bairro Publico",
        cep: "01310100",
        estado: "SP",
        municipio: "Sao Paulo",
      },
    });
    const id = community.id_profile;
    if (privacy === "private") {
      await CommunityStorage.setPrivacy(pool, id, { privacy: "private", monthly_cents: 1000 });
    }
    // XP fixo para tornar determinística a asserção de vazamento de contadores.
    await db.query(
      `UPDATE public.tb_profile SET xp_total = 500, xp_level = 3 WHERE id_profile = $1`,
      [id]
    );
    await CommunityStorage.addMember(pool, id, owner, "leader");
    return id;
  }

  const leader = await mkUser("leader");
  const memberU = await mkUser("member");
  const outsider = await mkUser("outsider");

  const pub = await mkCommunity(leader, { kind: "common", privacy: "public", name: mk("Publica") });
  const priv = await mkCommunity(leader, { kind: "common", privacy: "private", name: mk("Privada") });
  const condo = await mkCommunity(leader, { kind: "condo", privacy: "public", name: mk("Condo") });

  await CommunityStorage.addMember(pool, priv, memberU, "member");
  await CommunityStorage.addMember(pool, condo, memberU, "member");

  const V = (id) => (id ? { id_user: id } : null);

  console.log("\n━━━ 1. listagem pública ━━━");
  const listAnon = await CommunityService.listPublic({ q: String(stamp) }, null);
  const byId = (list, id) => list.communities.find((c) => String(c.id_profile) === String(id));

  check("temática pública mantém member_count para anônimo", () => {
    assert.ok("member_count" in byId(listAnon, pub));
  });
  check("temática privada esconde member_count de anônimo", () => {
    assert.strictEqual("member_count" in byId(listAnon, priv), false);
  });
  check("condomínio esconde member_count de anônimo", () => {
    assert.strictEqual("member_count" in byId(listAnon, condo), false);
  });
  check("condomínio esconde xp_total e xp_level de anônimo", () => {
    const row = byId(listAnon, condo);
    assert.strictEqual("xp_total" in row, false);
    assert.strictEqual("xp_level" in row, false);
  });

  const listMember = await CommunityService.listPublic({ q: String(stamp) }, V(memberU));
  check("membro vê member_count da própria comunidade privada", () => {
    assert.ok("member_count" in byId(listMember, priv));
  });
  const listOutsider = await CommunityService.listPublic({ q: String(stamp) }, V(outsider));
  check("forasteiro logado NÃO vê member_count de privada onde não entrou", () => {
    assert.strictEqual("member_count" in byId(listOutsider, priv), false);
  });
  check("forasteiro logado NÃO vê member_count do condomínio", () => {
    assert.strictEqual("member_count" in byId(listOutsider, condo), false);
  });

  console.log("\n━━━ 2. busca por endereço ━━━");
  const byStreet = await CommunityService.listPublic({ q: "Rua Secreta" }, null);
  check("busca por rua NÃO encontra o condomínio (C4)", () => {
    assert.strictEqual(byId(byStreet, condo), undefined);
  });
  const byHood = await CommunityService.listPublic({ q: "Bairro Publico" }, null);
  check("busca por bairro ENCONTRA o condomínio", () => {
    assert.ok(byId(byHood, condo));
  });

  console.log("\n━━━ 3. lista de membros ━━━");
  const mPrivOut = await CommunityService.getMembers({ id_profile: priv }, V(outsider));
  check("privada recusa forasteiro na lista de membros (C3)", () => {
    assert.strictEqual(mPrivOut.statusCode, 403);
  });
  const mPrivMember = await CommunityService.getMembers({ id_profile: priv }, V(memberU));
  check("privada libera membro na lista de membros", () => {
    assert.ok(Array.isArray(mPrivMember.members));
  });
  const mPubAnon = await CommunityService.getMembers({ id_profile: pub }, null);
  check("temática pública segue com lista aberta", () => {
    assert.ok(Array.isArray(mPubAnon.members));
  });
  const mCondoMember = await CommunityService.getMembers({ id_profile: condo }, V(memberU));
  check("condomínio recusa membro que não é morador", () => {
    assert.strictEqual(mCondoMember.statusCode, 403);
  });

  // Promove memberU a morador confirmado do condomínio.
  const unit = await CondoStorage.createUnit(pool, condo, { id_block: null, number: "101" });
  await CondoStorage.setUnitHolder(pool, unit.id_unit, memberU);
  const mCondoResident = await CommunityService.getMembers({ id_profile: condo }, V(memberU));
  check("condomínio libera morador confirmado", () => {
    assert.ok(Array.isArray(mCondoResident.members));
  });

  console.log("\n━━━ 4. metas e benchmark ━━━");
  const gPrivAnon = await CommunityService.getGoal({ id_profile: priv }, null);
  check("/goal recusa anônimo em privada (C2)", () => {
    assert.strictEqual(gPrivAnon.statusCode, 403);
  });
  const gPrivOut = await CommunityService.getGoal({ id_profile: priv }, V(outsider));
  check("/goal recusa forasteiro em privada", () => {
    assert.strictEqual(gPrivOut.statusCode, 403);
  });
  const gCondoOut = await CommunityService.getGoal({ id_profile: condo }, V(outsider));
  check("/goal recusa forasteiro em condomínio", () => {
    assert.strictEqual(gCondoOut.statusCode, 403);
  });
  const gCondoResident = await CommunityService.getGoal({ id_profile: condo }, V(memberU));
  check("/goal libera morador confirmado do condomínio", () => {
    assert.strictEqual(gCondoResident.statusCode, undefined);
  });
  const gPubAnon = await CommunityService.getGoal({ id_profile: pub }, null);
  check("/goal segue aberto em temática pública", () => {
    assert.strictEqual(gPubAnon.statusCode, undefined);
  });
  const bPrivAnon = await CommunityService.getBenchmark({ id_profile: priv }, null);
  check("/benchmark recusa anônimo em privada", () => {
    assert.strictEqual(bPrivAnon.statusCode, 403);
  });

  console.log("\n━━━ 5. getById ━━━");
  const cCondoAnon = await CommunityService.getById({ id_profile: condo }, null);
  check("getById de condomínio esconde contadores de anônimo", () => {
    assert.strictEqual("member_count" in cCondoAnon.community, false);
  });
  check("getById de condomínio ainda devolve bairro/cidade", () => {
    assert.strictEqual(cCondoAnon.community.address.neighborhood, "Bairro Publico");
    assert.strictEqual(cCondoAnon.community.address.street, undefined);
  });
  const cCondoRes = await CommunityService.getById({ id_profile: condo }, V(memberU));
  check("getById de condomínio devolve rua ao morador", () => {
    assert.strictEqual(cCondoRes.community.address.street, "Rua Secreta");
  });

  // ─── limpeza + relatório ────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = ANY($1::uuid[])`, [[pub, priv, condo]]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [[leader, memberU, outsider]]);
  await db.end();
  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n━━━ RESULTADO ━━━\n  ${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Subir o Postgres de teste**

```bash
docker run -d --name fl-test-pg -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=freelandoo_test -p 55432:5432 postgres:16-alpine
```

Se o container já existir: `docker start fl-test-pg`

- [ ] **Step 4: Rodar a suíte**

Run: `npm run test:privacy`
Expected: `23/23 OK` e exit 0

- [ ] **Step 5: Rodar de novo (idempotência)**

Run: `npm run test:privacy`
Expected: `23/23 OK` de novo — a suíte cria fixtures com sufixo de timestamp e limpa no fim, então rodar duas vezes não pode falhar

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 7: Commit**

```bash
git add test/community-privacy.e2e.js package.json
git commit -m "test(comunidades): smoke e2e da blindagem de privacidade (C1-C4)"
```

---

## Task 8: Frontend — contadores opcionais e token nas chamadas

**Files:**
- Modify: `"../freelandoo frontend/freelandoo-website-main/components/community/community-tile.tsx"`
- Modify: `"../freelandoo frontend/freelandoo-website-main/app/(header-only)/comunidades/[id]/page.tsx"`
- Modify: `"../freelandoo frontend/freelandoo-website-main/app/(header-only)/comunidades/[id]/_components/condo-view.tsx"`

> **Esta task é obrigatória e sai junto com o backend.** Remover `member_count` da resposta pública **quebra** o frontend atual — os três arquivos abaixo leem o campo direto.

- [ ] **Step 1: Tornar os contadores opcionais no tile da vitrine**

Em `components/community/community-tile.tsx`, no type do componente (linhas ~18-19), trocar:

```ts
  member_count: number
  xp_level: number
```

por:

```ts
  member_count?: number
  xp_level?: number
```

Na linha ~87, trocar o bloco do troféu por:

```tsx
          {community.xp_level != null ? (
            <>
              <Trophy className="h-3 w-3" style={{ color: accent }} /> {community.xp_level}
            </>
          ) : null}
```

E na linha ~122, trocar `{community.member_count}{" "}` por:

```tsx
            {community.member_count ?? "—"}{" "}
```

- [ ] **Step 2: Tornar os contadores opcionais na página da comunidade**

Em `app/(header-only)/comunidades/[id]/page.tsx`, no type `Community` (linhas ~47-49), trocar:

```ts
  xp_total: number
  xp_level: number
  member_count: number
```

por:

```ts
  xp_total?: number
  xp_level?: number
  member_count?: number
```

Na linha ~612, trocar por:

```tsx
              <span className="fl-display text-2xl leading-none" style={{ color: accent }}>{community.xp_level ?? "—"}</span>
```

Nas linhas ~664-666, trocar os três `Kpi` por:

```tsx
          <Kpi icon={<Users className="h-4 w-4" />} label={t("membersCount", "membros")} value={community.member_count != null ? compact(community.member_count) : "—"} accent={accent} />
          <Kpi icon={<Trophy className="h-4 w-4" />} label={t("level", "Nível")} value={community.xp_level != null ? String(community.xp_level) : "—"} accent={accent} />
          <Kpi icon={<Sparkles className="h-4 w-4" />} label="XP" value={community.xp_total != null ? compact(community.xp_total) : "—"} accent={accent} />
```

Na linha ~737, trocar por:

```tsx
                    🏆 {t("goalPrizeNote", "100 poléns pro 1º lugar")} · {t("goalMinMembers", "mín. 5 membros")} {(community.member_count ?? 0) < 5 ? `(${community.member_count ?? 0}/5)` : ""}
```

Na linha ~740, trocar a condição do `disabled` por:

```tsx
disabled={savingGoal || (community.member_count ?? 0) < 5}
```

- [ ] **Step 3: Mandar o token nas chamadas de goal e benchmark**

Ainda em `page.tsx`. O `fetchGoal` (linhas 216-220) hoje não tem token nenhum no escopo — substituir o callback inteiro por:

```tsx
  const fetchGoal = useCallback(async () => {
    const token = getToken()
    const r = await fetch(`/api/communities/${id}/goal`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const d = await r.json().catch(() => ({}))
    setGoal(d.goal || null)
  }, [id])
```

Nas linhas ~261 e ~263 (o `Promise.all` que já monta `authHeaders` na linha ~257), trocar por:

```tsx
        fetch(`/api/communities/${id}/goal`, authHeaders ? { headers: authHeaders } : undefined),
        fetch(`/api/communities/${id}/benchmark`, authHeaders ? { headers: authHeaders } : undefined),
```

- [ ] **Step 4: Tornar o contador opcional na visão de condomínio**

Em `app/(header-only)/comunidades/[id]/_components/condo-view.tsx`, na linha ~27 trocar `member_count: number` por `member_count?: number`, e na linha ~651 trocar por:

```tsx
            {community.member_count ?? "—"} {t("residentsCount", "moradores")}
```

- [ ] **Step 5: Typecheck**

Run (no diretório do frontend): `npx tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: sem erros e sem warnings

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build concluído sem erro

- [ ] **Step 8: Commit (só os três arquivos)**

```bash
git add "components/community/community-tile.tsx" \
        "app/(header-only)/comunidades/[id]/page.tsx" \
        "app/(header-only)/comunidades/[id]/_components/condo-view.tsx"
git commit -m "fix(comunidades): contadores opcionais e token em goal/benchmark"
```

> **Nunca** `git add -A` aqui: há WIP paralelo no working tree do frontend.

---

## Task 9: Bloqueio parental devolve 403 (bug pré-existente)

**Files:**
- Modify: `src/utils/supervision.js` (10 pontos de retorno)

> **Task independente.** Não faz parte de C1–C4, mas é da mesma família (correção de autorização) e
> o §7.4 do spec depende dela: o desenho das comunidades territoriais precisa distinguir "não
> autorizado" de "requisição malformada". Pode ser pulada sem afetar as outras tasks.

**O bug:** todos os guards de `src/utils/supervision.js` retornam `{ error, status: 403 }`, mas
`sendServiceResult` lê **`statusCode`** e ignora `status` (ver `src/utils/sendServiceResult.js:33`).
O fallback `statusFromServiceError` então classifica pelo texto — e nenhuma dessas mensagens contém
"permissão", "não encontrado" ou "não autenticado". Resultado: **todo bloqueio parental responde 400
em vez de 403**. A mensagem chega certa e o bloqueio funciona, então nada está quebrado para o
usuário final; o que quebra é qualquer cliente que ramifique por status.

**Por que é seguro:** os 20+ chamadores fazem exclusivamente `if (block) return block;` e repassam o
objeto ao `sendServiceResult`. Nenhum lê `.status`.

- [ ] **Step 1: Confirmar que nenhum chamador lê `.status`**

Run: `grep -rn "Block\.status\|Block\?\.status\|block\.status" src/`
Expected: nenhuma ocorrência

- [ ] **Step 2: Trocar `status` por `statusCode` nos 10 retornos**

Em `src/utils/supervision.js`, substituir **todas** as ocorrências de `status: 403,` por
`statusCode: 403,`. São 10, em 7 funções: `assertLinkActiveIfMinor` (2),
`assertNotMinorForServiceRequest` (1), `assertNotMinorForShowcase` (1), `assertNotMinorForRanking`
(1), `assertNotMinorForMural` (1), `assertMinorPermission` (2), `assertMachineAllowed` (2).

Atualizar também o comentário do cabeçalho do arquivo, trocando:

```js
 * Convenção: helpers que retornam booleano não lançam. Helpers `assertNot*`
 * retornam `null` (ok) ou `{ error, status }` (bloqueio) para encaixar no
 * padrão `sendServiceResult` dos services.
```

por:

```js
 * Convenção: helpers que retornam booleano não lançam. Helpers `assertNot*`
 * retornam `null` (ok) ou `{ error, statusCode }` (bloqueio) para encaixar no
 * padrão `sendServiceResult` dos services.
 *
 * O campo é `statusCode`, NÃO `status`: sendServiceResult lê `result.statusCode`
 * e ignora `status` — com `status` o bloqueio caía no fallback por texto e
 * respondia 400 em vez de 403.
```

- [ ] **Step 3: Verificar que não sobrou nenhum `status:` no arquivo**

Run: `grep -n "status: 4" src/utils/supervision.js`
Expected: nenhuma ocorrência

Run: `grep -c "statusCode: 403" src/utils/supervision.js`
Expected: `10`

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add src/utils/supervision.js
git commit -m "fix(parental): bloqueio de conta supervisionada devolve 403, não 400"
```

---

## Task 10: Validação final

- [ ] **Step 1: Backend — unit + smoke + lint**

```bash
npm run test:unit && npm run test:privacy && npm run lint
```
Expected: `# fail 0` no unit, `23/23 OK` no smoke, lint limpo

- [ ] **Step 2: Confirmar que a regra antiga sumiu do código de negócio**

Run: `grep -rn "kind === \"condo\"" src/services/`
Expected: **apenas** as ocorrências que tratam de *comportamento* de condomínio (endereço, moradores, `_assertCanViewPrivateContent`) — **nenhuma** decidindo exposição de contador, lista de membros, goal ou benchmark. Essas quatro decisões agora vivem só em `src/utils/communityPolicy.js`.

- [ ] **Step 3: Conferir que o WIP alheio segue intocado**

Run: `git status --porcelain`
Expected: exatamente as três linhas ` M src/controllers/AdminUsersController.js`, ` M src/routes/adminUsers.routes.js`, ` M src/storages/AdminUsersStorage.js` — nada mais

- [ ] **Step 4: Push (pedir autorização antes)**

O push na `main` dispara rebuild no Railway. **Confirmar com o Alex antes.** Backend e frontend têm que ir juntos — a remoção de `member_count` da resposta pública quebra o frontend antigo.

```bash
# backend
git push origin main
# frontend (no diretório do frontend)
git push origin main
```

---

## Riscos e o que fica pendente

| Risco | Mitigação |
|---|---|
| Deploy fora de ordem quebra a vitrine | Backend e frontend sobem juntos (Task 10, Step 4). O frontend novo tolera o backend antigo (campo presente), mas o backend novo **não** tolera o frontend antigo |
| Alguma superfície não mapeada lê `member_count` | Task 10 Step 2 + o typecheck da Task 8 pegam os consumidores tipados. Consumidor não tipado (fetch solto) não é pego — **QA visual da vitrine e da página de comunidade fica com o Alex** |
| `listPublic` ganhou uma query a mais para viewer logado | É uma só (`listForUser`), não N+1. Sem índice novo: `idx_community_member_user` já existe (mig 154) |

**Não entra nesta entrega** (vem nos subsistemas seguintes): tier `morador não reconhecido` (Subsistema 3), modalidade `neighborhood` na política (Subsistema 4), `no-store` nas páginas territoriais e exclusão da rota SEO (Subsistema 4), e a proibição de CEP/número em log (Subsistema 2, quando esses campos passarem a existir).
