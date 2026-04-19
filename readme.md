# Creators Views (API)

Backend em Node.js (Express 5) com PostgreSQL, Mercado Pago e armazenamento R2.

## Requisitos

- Node.js 18+
- PostgreSQL

## Configuração

1. Copie o exemplo de variáveis e ajuste os valores:

   `cp .env.example .env`

2. Conexão PostgreSQL: por padrão **não** usa SSL (`DATABASE_SSL` omitido ou `false`). Em produção com provedor que exige SSL (Neon, Supabase, etc.), defina `DATABASE_SSL=true`. Se o provedor usar certificado não verificável pelo Node, use `DATABASE_SSL_REJECT_UNAUTHORIZED=false` (somente quando necessário).

3. Instale dependências e suba em desenvolvimento:

   `npm install`

   `npm run dev`

## Scripts

- `npm run dev` — servidor com nodemon
- `npm start` — produção (`node index.js`)
- `npm run lint` — ESLint
- `npm run format` — Prettier

## Convenções do projeto

- Rotas: `*.routes.js` em `src/routes/`
- Storages: `PascalStorage.js` em `src/storages/`
- Handlers assíncronos envolvidos com `asyncHandler` para erros irem ao middleware global em `src/app.js`
