# Sistema de agenda (booking) — documentação para o frontend

Este documento descreve o funcionamento do backend Freelandoo relacionado a **disponibilidade**, **slots**, **criação de agendamentos**, **pagamento (Stripe)** e **listagens**. Use como contrato de API ao depurar o app frontend no Cursor.

**Prefixo da API:** substitua `{API_BASE}` pela URL base do backend (ex.: `http://localhost:3000`). Todas as rotas abaixo são relativas a essa base.

**Autenticação (rotas do dono):** header obrigatório

```http
Authorization: Bearer <JWT>
```

O JWT é o token retornado pelo fluxo de login (`JWT_SECRET` no servidor valida a assinatura). Sem `Bearer ` o middleware responde `401` com `{ "error": "Token não informado" }`.

**Formato de erros:** quando o serviço retorna `{ "error": "mensagem" }`, o HTTP costuma ser `400`, `403`, `404` ou `401`, conforme o texto (ver `sendServiceResult` no backend).

---

## Visão geral do fluxo

1. **Dono do perfil** configura regras semanais e, opcionalmente, exceções por data (`/profile/:id_profile/...`).
2. **Dono** pode ativar aceite de agendamentos em configurações (`allow_booking`); o fluxo público de slots exige perfil **visível** e dados de disponibilidade — sem regra para aquele dia da semana, os slots vêm **vazios**.
3. **Visitante** lista serviços do perfil, pede slots para uma data ou semana (`/public/profile/...`).
4. **Visitante** cria agendamento (POST): servidor valida assinatura ativa do perfil, serviço, sobreposição de horário e abre **Stripe Checkout**; resposta inclui `checkout_url`.
5. Após pagamento bem-sucedido, o **webhook Stripe** marca o booking como `confirmed` / `paid`.

---

## Modelo mental dos dados

| Conceito | Onde está | Observação |
|----------|-----------|------------|
| Regra por dia da semana (0=dom … 6=sáb) | `tb_profile_availability_rules` | Horário de trabalho + duração do slot + buffer |
| Exceção por data específica | `tb_profile_availability_overrides` | Bloquear dia, mudar janela, slots extras/bloqueados |
| Ligar agenda / legacy de valores | `tb_profile_booking_settings` | `allow_booking`; checkout atual usa **preço do serviço** |
| Agendamento | `tb_profile_bookings` | Estados `pending_payment`, `confirmed`, etc. |

---

## 1. Configurar disponibilidade (don — autenticado)

Montagem Express: `app.use("/profile", bookingRoutes)` — ou seja, paths começam com **`/profile`**.

### 1.1 Regras semanais

**GET** `{API_BASE}/profile/{id_profile}/availability`

- Retorno típico: `{ "rules": [ ... ] }` — cada item: `weekday`, `is_enabled`, `start_time`, `end_time`, `slot_duration_minutes`, `buffer_minutes`.

**POST** `{API_BASE}/profile/{id_profile}/availability`

Body JSON:

```json
{
  "rules": [
    {
      "weekday": 1,
      "is_enabled": true,
      "start_time": "09:00",
      "end_time": "18:00",
      "slot_duration_minutes": 60,
      "buffer_minutes": 0
    }
  ]
}
```

- `weekday` fora de `0..6` é **ignorado** no loop (não gera erro).
- Defaults no servidor se omitidos: `start_time` `"08:00"`, `end_time` `"18:00"`, duração `60`, buffer `0`.

**Importante para o frontend:** se **não existir** linha para aquele `weekday` no banco, `getRuleForDate` retorna tipo `"none"` → **lista de slots vazia** para essa data. O dono precisa ter salvado regra para os dias em que quer aparecer disponível.

### 1.2 Exceções por data

**GET** `{API_BASE}/profile/{id_profile}/availability-overrides`

**POST** `{API_BASE}/profile/{id_profile}/availability-overrides`

Body JSON (campos comuns):

```json
{
  "override_date": "2026-05-20",
  "is_day_blocked": false,
  "custom_start_time": "10:00",
  "custom_end_time": "16:00",
  "extra_slots_json": ["09:00", "17:00"],
  "blocked_slots_json": ["12:00"],
  "note": "Feriado parcial"
}
```

- `override_date` obrigatória no POST.
- `extra_slots_json` / `blocked_slots_json` podem ser array JSON (objeto no Node é serializado no INSERT).

**DELETE** `{API_BASE}/profile/{id_profile}/availability-overrides/{overrideId}`

---

## 2. Configurações de booking (don — autenticado)

**GET** `{API_BASE}/profile/{id_profile}/booking-settings`

**POST** `{API_BASE}/profile/{id_profile}/booking-settings`

Body (o código atual só propaga explicitamente):

```json
{
  "allow_booking": true
}
```

Outros campos legacy (`deposit_amount`, etc.) podem existir na tabela; o checkout público usa o **preço do serviço**.

---

## 3. Serviços do perfil (público — necessário para agendar)

Para montar o fluxo “escolher serviço → escolher horário”, o frontend precisa dos serviços ativos:

**GET** `{API_BASE}/public/profile/{id_profile}/services`

`{id_profile}` é o UUID do perfil (mesmo usado nas rotas de agenda pública).

---

## 4. Horários disponíveis (público — sem auth)

Montagem: `app.use("/public/profile", bookingPublicRoutes)`.

### 4.1 Slots de um único dia

**GET** `{API_BASE}/public/profile/{id_profile}/available-slots?date=YYYY-MM-DD`

**Query obrigatória:** `date` no formato **`YYYY-MM-DD`**.

Resposta típica:

```json
{
  "slots": [
    { "start": "09:00", "end": "10:00" },
    { "start": "10:00", "end": "11:00" }
  ]
}
```

Casos especiais:

- Perfil não encontrável / deletado / invisível → `{ "error": "..." }` ou mensagem de indisponível.
- Data no passado → `{ "slots": [], "message": "Data no passado" }`.
- Dia bloqueado por override → `{ "slots": [], "message": "Dia bloqueado" }`.
- Sem regra para aquele dia da semana e sem override útil → `{ "slots": [] }`.

### 4.2 Semana completa (calendário)

**GET** `{API_BASE}/public/profile/{id_profile}/calendar/week?weekStart=YYYY-MM-DD&weekEnd=YYYY-MM-DD`

**Ambos** `weekStart` e `weekEnd` são obrigatórios.

Resposta típica:

```json
{
  "weekStart": "2026-05-11",
  "weekEnd": "2026-05-17",
  "availableSlots": [
    { "date": "2026-05-11", "slots": [...] },
    { "date": "2026-05-12", "slots": [...] }
  ],
  "events": [
    {
      "id": "123",
      "title": "Reservado",
      "start": "2026-05-12T09:00:00",
      "end": "2026-05-12T10:00:00",
      "status": "confirmed",
      "meta": undefined
    }
  ]
}
```

- **`events`:** bookings **não** cancelados/expirados; `status` visual pode ser `pending_payment` ou `confirmed`.
- **Modo dono:** **GET** `{API_BASE}/profile/{id_profile}/calendar/week?weekStart=...&weekEnd=...` (com JWT). Mesma lógica de slots, mas `events[].title` / `meta` incluem dados do cliente quando aplicável.

Se o perfil estiver invisível/deletado e a chamada for **pública**, o backend devolve **200** com `availableSlots: []` e `events: []` (sem erro explícito).

---

## 5. Criar agendamento (público — sem auth na API)

**POST** `{API_BASE}/public/profile/{id_profile}/bookings`

Body JSON:

```json
{
  "client_name": "Maria",
  "client_email": "maria@email.com",
  "client_whatsapp": "+5511999999999",
  "booking_date": "2026-05-15",
  "start_time": "09:00",
  "id_profile_service": 42
}
```

Campos obrigatórios: `client_name`, `client_email`, `booking_date`, `start_time`, **`id_profile_service`** (número do serviço).

Sucesso (**201**): exemplo de formato:

```json
{
  "booking": { "...campos da linha tb_profile_bookings..." },
  "checkout_url": "https://checkout.stripe.com/..."
}
```

O cliente deve ser redirecionado para `checkout_url` para pagar. URLs de sucesso/cancelamento são montadas com `FRONTEND_URL` no servidor.

Erros frequentes (exemplos):

- `"Perfil não disponível para agendamento"` — sem assinatura ativa para o perfil.
- `"Selecione um serviço para agendar"` — falta `id_profile_service`.
- `"Horário indisponível: ..."` — conflito de intervalo com outro booking ativo (inclui `pending_payment`).
- Valor do serviço abaixo da taxa mínima da plataforma.

---

## 6. Listar agendamentos (don — autenticado)

**GET** `{API_BASE}/public/profile/my-bookings`

Lista bookings em que você é **`profile_owner_user_id`** (todos os seus perfis).

**GET** `{API_BASE}/profile/{id_profile}/bookings`

Lista apenas daquele perfil; exige ser dono do `id_profile`.

Observação: paginação **não** é exposta pelos controllers atuais — limite fixo no storage (**50** registros, offset 0).

---

## 7. Atualizar status operacional (don — autenticado)

**PATCH** `{API_BASE}/public/profile/bookings/{bookingId}/status`

Body:

```json
{
  "status": "completed"
}
```

Valores permitidos: `completed`, `no_show`, `canceled`.

---

## 8. Confirmação por pagamento (Stripe — servidor)

Não é chamada pelo frontend: evento `checkout.session.completed` com `metadata.type === "booking_deposit"` dispara atualização do booking para `confirmed` / `paid`.

Para testes locais o frontend precisa de webhook Stripe ou fluxo de teste configurado no Stripe Dashboard apontando para o backend.

---

## Checklist de depuração (“agenda não funciona no frontend”)

1. **URL correta**
   - Público: sempre **`/public/profile/{uuid}/...`**
   - Dono (disponibilidade): **`/profile/{uuid}/...`** com Bearer token

2. **`id_profile` é UUID** do perfil, igual ao usado na página pública do freelancer.

3. **Slots vazios**
   - Existe **POST** de regras semanais para o `weekday` daquela data?
   - Override não está com `is_day_blocked: true`?
   - Perfil `is_visible`?

4. **POST booking falha**
   - Assinatura ativa do perfil no backend?
   - Serviço existe em **`GET /public/profile/:id/services`** e `id_profile_service` está correto?
   - `booking_date` / `start_time` exatamente como strings esperadas (`YYYY-MM-DD`, `HH:MM`)?

5. **CORS:** se o frontend está em outra origem, o servidor precisa permitir o origin e métodos (OPTIONS).

6. **Timezone:** o backend mistura UTC (`T12:00:00Z` para weekday) e “hoje” com `setHours(0,0,0,0)` no fuso do **servidor**. Em produção, alinhar interpretação de “dia” entre cliente e servidor evita slots sumindo no limite do dia.

7. **Grade vs sobreposição:** a lista de slots remove apenas starts que **coincidem** com `start_time` de bookings existentes; a **criação** do booking valida **sobreposição real** de intervalos. Evite durations inconsistentes entre serviço e regra semanal.

---

## Referência rápida de rotas

| Método | Path | Auth |
|--------|------|------|
| GET/POST | `/profile/:id_profile/availability` | Sim |
| GET/POST | `/profile/:id_profile/availability-overrides` | Sim |
| DELETE | `/profile/:id_profile/availability-overrides/:overrideId` | Sim |
| GET/POST | `/profile/:id_profile/booking-settings` | Sim |
| GET | `/profile/:id_profile/bookings` | Sim |
| GET | `/profile/:id_profile/calendar/week` | Sim |
| GET | `/public/profile/:id_profile/services` | Não |
| GET | `/public/profile/:id_profile/available-slots` | Não |
| GET | `/public/profile/:id_profile/calendar/week` | Não |
| POST | `/public/profile/:id_profile/bookings` | Não |
| GET | `/public/profile/my-bookings` | Sim |
| PATCH | `/public/profile/bookings/:bookingId/status` | Sim |

---

## Arquivos no backend (para aprofundar)

- `src/services/BookingService.js` — criação + Stripe + regras de negócio
- `src/services/BookingAvailabilityService.js` — slots e semana
- `src/storages/BookingStorage.js` — overlap, listagens
- `src/storages/BookingAvailabilityStorage.js` — persistência de regras/overrides
- `src/routes/booking.routes.js`, `src/routes/bookingPublic.routes.js`
- `src/databases/migrations/010_booking_calendar.sql` — schema

---

*Documento gerado com base no código do repositório `freelandoo-backend`; se algo divergir após deploy, compare com as rotas em `src/routes/index.js`.*
