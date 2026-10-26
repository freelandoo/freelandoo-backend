# API de parceiro de academia — contrato (v1)

Contrato que o **software de uma academia** (primeiro: o Coliseu) usa para criar ou
vincular a conta do aluno na Freelandoo e acompanhar foto, situação e treino. É o
sentido **academia → Freelandoo**; o sentido contrário (Freelandoo puxando matrícula,
catraca e pagamentos) é a [Gym Provider API](API_GYM_PROVIDER.md) e continua igual.

Spec de origem: `coliseu-backend/docs/superpowers/specs/2026-10-20-coliseu-freelandoo-acesso-design.md`.
Migration: `296_academy_partner_access.sql`.

## Autenticação

`Authorization: Bearer <chave de parceiro>` em toda chamada.

- A chave começa com `flnd_parc_` e identifica **uma** academia (`tb_academy`). Tudo
  é escopado a ela: membro de outra academia responde `404 nao_encontrado`.
- A Freelandoo guarda só o SHA-256 (`tb_academy.partner_key_hash`); a chave crua
  aparece **uma vez**, na hora em que é gerada. Gerar de novo **rotaciona**: a
  anterior para de valer na hora.
- Chave ausente, malformada, rotacionada ou de academia inativa →
  `401 { "erro": "chave_invalida" }`.
- A API de parceiro **não depende** da flag global `fitness_academias`: a chave só
  existe porque o dono da academia a gerou (opt-in explícito daquela academia).

### Como gerar a chave

- **Tela:** dono logado → página da academia (`/academias/<slug>`) → painel de
  gestão → card **"Chave de parceiro (Coliseu)"** → Gerar / Rotacionar → Copiar.
  (`POST /academies/:id/partner-key` devolve `{ chave, criado_em }`;
  `GET /academies/:id/partner-key` devolve `{ existe, criado_em }`. Só o dono; atrás
  da flag `fitness_academias`, como o resto de `/academias`.)
- **Linha de comando** (sem depender da tela nem da flag):

  ```
  DATABASE_URL=<url do banco> node scripts/gerar-chave-parceiro.js <slug-da-academia>
  ```

  Imprime só a chave no stdout (as mensagens vão para o stderr).

## Convenções

- JSON em `application/json` (exceto a foto, multipart). CPF sempre 11 dígitos.
- Datas: `data_nascimento` em `YYYY-MM-DD`; demais em ISO-8601 UTC.
- Erros: status HTTP + `{ "erro": "<código estável>" }`. O parceiro decide o que
  mostrar pelo código.

## 1. `POST /partner/v1/members` — criar ou vincular

```json
{
  "cpf": "52998224725",
  "nome": "Maria José da Silva",
  "email": "maria@exemplo.com",
  "data_nascimento": "1995-03-10",
  "telefone": "5511999998888",
  "ref_externa": "<id da pessoa no software da academia>"
}
```

`telefone` (dígitos com DDI) e `ref_externa` são opcionais.

Regras que a Freelandoo aplica sozinha:

| Situação | Resposta |
|---|---|
| CPF com dígito verificador errado (ou ausente) | `422 { erro: "cpf_invalido" }` |
| Falta `nome`, `email` ou `data_nascimento` (ou formato inválido) | `422 { erro: "dados_incompletos" }` |
| Menos de 18 anos | `422 { erro: "menor_de_idade" }` |
| CPF **já tem conta** | vincula (`tb_academy_member`, grava `ref_externa`) → `200 { id_user, status: "vinculado", estado }` — nunca mexe em senha, e-mail ou foto |
| CPF novo, e-mail já usado por outra conta | `409 { erro: "email_em_uso" }` |
| O CPF já está vinculado nesta academia a **outra** conta | `409 { erro: "cpf_vinculado_outra_conta" }` (caso raro, resolver na recepção) |
| CPF novo | cria a conta → `201 { id_user, status: "criado", estado: "aguardando_aceite", link_primeiro_acesso, expira_em }` |

- **Idempotente por CPF**: chamar duas vezes (inclusive ao mesmo tempo) nunca cria
  duas contas; a segunda resposta é `vinculado`.
- `estado`: `aguardando_aceite` (o aluno ainda não aceitou os termos no primeiro
  login) ou `ativa`.
- A conta nova nasce sem senha, inativa, com username `nome.sobrenome` (número no fim
  se preciso) e **invisível** na plataforma (busca, ranking, perfis públicos) até o
  aceite.
- O vínculo nasce com `membership_status = pending`; o sync da Gym Provider API
  grava o status real da matrícula no ciclo seguinte.

## 2. `POST /partner/v1/members/:id_user/link` — novo link de primeiro acesso

→ `200 { link_primeiro_acesso, expira_em }`. O link anterior deixa de valer.

- Conta que já criou a senha (ou já é conta comum/aceita) → `409 { erro: "ja_aceito" }`
  (para senha esquecida existe o "Esqueci a senha").
- Usuário não vinculado a esta academia → `404 { erro: "nao_encontrado" }`.

Formato do link: `${FRONTEND_URL}/academia/<slug da academia>/primeiro-acesso?token=<token>`,
válido por **7 dias**, uso único (o token é guardado como hash em `tb_user_first_access`).

## 3. `PUT /partner/v1/members/:id_user/foto-academia` — foto do cadastro

Multipart, campo `foto`: `image/jpeg`, `image/png` ou `image/webp`, até 5 MB → `200 { ok: true }`.

- Guardada no R2 em `academy-photos/<id_academy>/<id_user>-<uuid>.<ext>`, **separada do
  avatar**. Só vira foto de perfil se o aluno marcar "usar a foto do meu cadastro na
  academia" no modal de aceite. Antes disso nunca é pública.
- Erros: `404 nao_encontrado`, `413 foto_grande_demais`, `415 formato_invalido`,
  `422 foto_obrigatoria`.

## 4. `GET /partner/v1/members?cursor=&limit=` — lote

`limit` padrão 200, máximo 500. Lista **todos** os vínculos da academia (conta apagada
simplesmente não aparece).

```json
{
  "itens": [
    {
      "id_user": "…",
      "cpf": "52998224725",
      "ref_externa": "pessoa-123",
      "estado": "ativa",
      "avatar_url": "https://…/avatars/….jpg",
      "treino": {
        "nome": "Treino A",
        "criado_em": "2026-10-20T12:00:00.000Z",
        "validade_dias": 60,
        "vence_em": "2026-12-19T12:00:00.000Z"
      },
      "proposta_treino_pendente": false
    }
  ],
  "proximo_cursor": "…"
}
```

- `avatar_url`: `null` enquanto `aguardando_aceite` (a conta não tem foto até o aceite).
- `treino`: a ficha **ativa mais recente** do aluno; `vence_em = criado_em + validade_dias`
  (30, 60 ou 90 dias, escolhidos por quem montou a ficha). `null` sem ficha ativa.
  Ficha revisada pelo professor e aceita pelo aluno recomeça a vigência (mig 305).
- `proposta_treino_pendente`: o professor já mandou uma ficha (nova ou revisada) e ela
  espera o aluno confirmar no app. Enquanto isso o aluno sai da fila do professor.
- `proximo_cursor`: opaco; `null` na última página. Cursor inválido →
  `400 { erro: "cursor_invalido" }`.

## 5. `GET /partner/v1/members/:id_user`

Mesmo formato de um item da lista. Fora desta academia → `404 { erro: "nao_encontrado" }`.

## 6. `POST /partner/v1/training-reminder` — avisar os professores

Sem corpo. Os professores da academia recebem de novo o modal da **fila de treinos**
(vencidos, vencendo e sem treino) — na hora, se estiverem com o app aberto, ou na
próxima vez que entrarem, mesmo que tenham dispensado o modal antes.

```json
{ "professores": 2, "pendentes": 37 }
```

- Academia sem professor cadastrado → `409 { erro: "sem_professor" }`.

## Lado do aluno (para referência)

- `GET /auth/primeiro-acesso/:token` → `{ valido, nome, academia: { nome, slug, logo } }`.
- `POST /auth/primeiro-acesso { token, senha }` → mesma sessão do `/auth/signin`
  (a senha segue a regra do cadastro; o e-mail conta como verificado).
- `GET /academy-onboarding` → `{ estado, academia, tem_foto, versao_termos }`;
  `GET /academy-onboarding/foto` (a foto da academia, autenticada).
- `POST /academy-onboarding/aceite { foto }` → grava `tb_user_consent` (versão
  `2026-10-20`, data, foto), conta `ativa`, e copia a foto para o avatar se `foto: true`.
- `POST /academy-onboarding/recusa` → apaga a conta e o vínculo (só para conta ainda
  aguardando aceite).

## Testes

`TEST_DATABASE_URL=postgres://…@localhost:…/… npm run test:academy-partner` (Postgres
local com todas as migrations) e `npm run test:unit` (`test/unit/academyPartner.test.js`).
