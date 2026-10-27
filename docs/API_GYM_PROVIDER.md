# Gym Provider API — contrato público (v1)

Contrato que um **software de academia** (CRM/controle de acesso) implementa para
conectar a academia à Freelandoo. A Freelandoo **puxa** os dados (pull/polling, a cada
~10 minutos) — o provider não precisa implementar push, webhook nem retry.

A primeira implementação de referência é o **Coliseu** (rotas `/api/freelandoo/*`).

> O sentido contrário — o software da academia **criando/vinculando a conta do aluno**
> na Freelandoo e lendo foto, situação e treino — é a API de parceiro
> (`/partner/v1`, chave `flnd_parc_`): ver [API_PARTNER.md](API_PARTNER.md).

## Cadastro na Freelandoo

O dono da academia cadastra em `freelandoo.com/academias`:

- **URL base** — ex.: `https://crm.minhaacademia.com.br` (HTTPS obrigatório; a Freelandoo
  chama `<base>/api/freelandoo/...`). Hosts de rede privada são recusados.
- **Token** — segredo gerado pelo software da academia. Enviado em toda chamada como
  `Authorization: Bearer <token>`. Recomenda-se comparação constant-time no provider.

Erros `401`/`403` marcam a conexão como inválida no painel do dono até o token ser
corrigido.

## Convenções

- CPF: sempre **11 dígitos**, sem máscara, nos dois sentidos.
- Datas: ISO-8601 com timezone (`2026-07-07T12:00:00.000Z`).
- `since` (cursor): string **opaca** devolvida pelo provider em `next_cursor`. A
  Freelandoo só ecoa de volta — o formato é decisão do provider. Primeiro poll vem sem
  `since` (retornar desde o início). IDs devem ser **estáveis** (a Freelandoo deduplica
  por eles).
- `limit`: máximo de itens por página (default 200; a Freelandoo pagina até esgotar).
- Respostas sempre `200 application/json` (erros com status HTTP apropriado + `{ "error" }`).

## 1. `GET /api/freelandoo/member?cpf=<11 dígitos>`

Consulta de matrícula por CPF — usada no vínculo (na hora, com o usuário esperando) e no
refresh diário de status.

```json
{
  "found": true,
  "name": "Maria Silva",
  "membership": {
    "status": "active",
    "plan_name": "Plano Mensal",
    "enrolled_at": "2026-01-10T00:00:00.000Z",
    "expires_at": "2026-08-10T00:00:00.000Z"
  }
}
```

- `found: false` (sem `name`/`membership`) quando o CPF não existe no cadastro.
- `membership: null` quando a pessoa existe mas nunca teve matrícula.
- `status`: `active` | `overdue` | `canceled` | `expired` | `pending`.
- A Freelandoo usa `status === 'active'` como condição de acesso ao painel fitness.

## 2. `GET /api/freelandoo/access-events?since=<cursor>&limit=<n>`

Giros de catraca **com passagem física confirmada** (só eles contam frequência).
Eventos são imutáveis; ordenar de forma estável (tempo + id).

```json
{
  "events": [
    { "id": "evt_123", "cpf": "12345678909", "at": "2026-07-07T09:12:00.000Z", "passed": true }
  ],
  "next_cursor": "MjAyNi0wNy0wN1QwOToxMjowMC4wMDBafGV2dF8xMjM"
}
```

- Retornar apenas eventos com `passed: true` e CPF conhecido.
- `next_cursor` deve avançar; quando não há eventos novos, devolver o mesmo cursor
  recebido (ou `null` no primeiro poll vazio) com `events: []`.

## 3. `GET /api/freelandoo/payments?since=<cursor>&limit=<n>`

Cobranças (mensalidades/matrículas) **criadas ou alteradas** desde o cursor — mudança de
status (ex.: `pending` → `paid`) deve reaparecer no feed (a Freelandoo faz upsert por
`id`).

```json
{
  "payments": [
    {
      "id": "cob_456",
      "cpf": "12345678909",
      "amount_cents": 9990,
      "due_date": "2026-07-10T00:00:00.000Z",
      "status": "paid",
      "paid_at": "2026-07-08T14:30:00.000Z"
    }
  ],
  "next_cursor": "..."
}
```

- `status`: `pending` | `paid` | `overdue` | `canceled` | `refunded`.
  `canceled` = cobrança cancelada antes de ser paga; `refunded` = estornada ou contestada
  (chargeback). Ambos desde 2026-10-06 (mig 273); status desconhecido vira `pending`.
- `paid_at: null` quando não pago.
- `method` (opcional, desde a mig 310): forma de recebimento em texto curto (`pix`, `boleto`,
  `dinheiro`…); `"freelandoo"` quando o aluno pagou pela Freelandoo. Só exibição.

## 4. Pagar pela Freelandoo (opcional, desde a mig 310)

O aluno pode pagar a mensalidade no app da Freelandoo (Mercado Pago da
Freelandoo). Ela retém a tarifa real do Mercado Pago + R$ 2,50 e repassa o resto
por PIX à chave que o dono cadastrou em "Recebimentos". Para isso o provedor
PRECISA dar baixa na cobrança — senão o aluno segue sendo cobrado lá.

Quem não implementa esta seção responde 404 em `capabilities` e o botão "Pagar"
não aparece para os alunos dele.

- `GET /api/freelandoo/capabilities` → `200 { "supports_paid_callback": true }`.
  Relido 1×/dia no sync.
- `GET /api/freelandoo/payments/:id` → o item no mesmo formato da lista (seção 3),
  ou 404. Chamado na hora de abrir o checkout: o valor e a situação valem DESTA
  resposta. A Freelandoo confere que o `cpf` é o do aluno.
- `POST /api/freelandoo/payments/:id/paid` com `{ "amount_cents", "paid_at", "ref" }`.
  `ref` = `freelandoo:<pedido>`. **Idempotente por `ref`** (repetir = 200).
  Respostas: 200 baixou; 409 `already_paid` (já pago por outro meio — a
  Freelandoo trata com o aluno); 5xx = a Freelandoo tenta de novo (a cada ~10 min,
  com recuo, por até 2 dias).
- `POST /api/freelandoo/payments/:id/reopened` com `{ "ref" }`: estorno na
  Freelandoo ANTES do repasse; a cobrança volta a ficar em aberto. Idempotente.

## Teste de conexão

O botão "Testar conexão" da Freelandoo chama `member?cpf=00000000000` e espera
`200 { "found": false }` — prova URL + token sem expor dados.

## Implementação de referência (Coliseu)

- Auth: `src/lib/freelandoo/auth.ts` (Bearer vs env `FREELANDOO_API_TOKEN`, constant-time).
- Queries/mapeamentos: `src/lib/freelandoo/provider.ts` + `mapping.ts` (cursores
- Pagar pela Freelandoo: `src/lib/freelandoo/baixa.ts` (baixa no Asaas por `receiveInCash`,
  reabertura por `undoReceivedInCash`, idempotência em `Cobranca.freelandooRef`).
  base64url `timestamp|id`; `Cobranca.updatedAt` adicionada por migration para o feed de
  payments detectar mudança de status).
