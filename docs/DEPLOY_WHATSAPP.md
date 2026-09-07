# Deploy do WhatsApp do usuário (Evolution API)

Receita para levantar a infraestrutura que faz a aba **WhatsApp** de
`/mensagens?tab=os` sair de *"ainda não está disponível nesta instalação"* e
passar a mostrar o QR Code.

O código está entregue (migs 223/224). O que falta é infraestrutura: **enquanto
`EVOLUTION_URL` e `EVOLUTION_API_KEY` não existirem no ambiente,
`integrations/evolution/config()` devolve `null`, o status sai com
`configured: false` e a aba escreve o aviso** — regra da mig 214: quem decide se
a integração aparece é a ENV, não a flag, porque flag ligada sem credencial
produz um botão que só falha depois do clique.

Arquitetura copiada do Coliseu (`C:/Users/Alex/Documents/Antigravity/Coliseu`,
`coliseu-backend/DEPLOY.md`), auditada no Railway em 2026-09-07 e adaptada.

---

## ⚠️ A diferença que muda tudo: lá é UMA instância, aqui é UMA POR PESSOA

No Coliseu existe um único WhatsApp — o da academia — e a instância vem de uma
ENV (`EVOLUTION_INSTANCE=coliseu`). Aqui **cada usuário conecta o próprio
número**: o nome da instância é derivado do `id_user`
(`utils/whatsappInstance.js`, prefixo `fl-u-`), é **UNIQUE** e é a **chave de
roteamento do webhook** — é por ele que se descobre de quem é a mensagem que
chegou.

**Por isso NÃO existe `EVOLUTION_INSTANCE` no ambiente da Freelandoo, de
propósito.** Uma instância global significaria um WhatsApp para o site inteiro,
e copiar do Coliseu o `instanciaAtualRepo()` ("a instância", no singular) faria
a mensagem de um usuário cair na caixa de outro **sem erro nenhum aparecer**.

Consequência operacional: **o mesmo servidor Evolution hospeda N sessões
simultâneas**, e cada sessão de pé custa memória todos os dias, tenha ou não
movimento. É exatamente o que a **mig 224** existe para conter — o sweeper
desliga a sessão de quem não abre a caixa há `WHATSAPP_IDLE_DAYS` (padrão 30;
`0` desliga o sweeper). Dimensione o serviço pensando em sessões *vivas*, não em
usuários cadastrados.

---

## Os serviços (projeto Railway da Freelandoo)

Recomendação: **instância própria da Freelandoo**, não reusar a do Coliseu. A
Evolution aguentaria as duas, mas misturaria dois produtos no mesmo servidor —
um restart pedido por um derrubaria as sessões do outro.

### 1. `redis`

Cache de sessão do Baileys — é o que evita repareamento por QR a cada
reconexão. **Sem volume**: é cache; se esvaziar, a Evolution recompõe a partir
dos arquivos em `/evolution/instances`.

- Imagem: `redis:7-alpine`
- Start command:

```
redis-server --bind :: --requirepass <SENHA_REDIS> --appendonly no
```

> **`--bind ::` não é opcional.** A rede privada da Railway é IPv6-only e o
> Redis só escuta IPv4 por padrão. Sem isso a Evolution não conecta no cache e a
> sessão do WhatsApp cai a cada restart.

Gere a senha com `openssl rand -hex 24`. **Não reaproveite a do Coliseu** — dois
produtos com a mesma credencial é um vazamento que se descobre tarde.

### 2. `evolution-api`

- Imagem: `evoapicloud/evolution-api:v2.3.7` (pinada; `latest` troca schema sem
  avisar)
- **Volume montado em `/evolution/instances`** — a sessão do WhatsApp vive aqui.
  Sem volume, todo restart pede QR de novo **de todos os usuários de uma vez**.
- **Sem domínio público.** Só rede interna: quem fala com ela é o backend, e a
  `AUTHENTICATION_API_KEY` é a única barreira que ela tem.
- Variáveis:

```
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=<URL do Postgres>?schema=evolution&connection_limit=5&pool_timeout=20
DATABASE_CONNECTION_CLIENT_NAME=evolution
AUTHENTICATION_API_KEY=<openssl rand -hex 32>
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://default:<SENHA_REDIS>@redis.railway.internal:6379
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_LOCAL_ENABLED=false
DEL_INSTANCE=false
SERVER_URL=http://evolution-api.railway.internal:8080
```

**`DEL_INSTANCE=false` é o que impede a Evolution de apagar sozinha a instância
de quem desconectou** — aqui a instância é a identidade da caixa de entrada da
pessoa, e apagá-la orfanaria o histórico dela no nosso banco.

#### Qual Postgres?

O Coliseu aponta para o **mesmo** banco da aplicação com `?schema=evolution`,
isolando as tabelas da Evolution das do produto. Funciona porque lá é uma
sessão só.

**Aqui recomendo um Postgres dedicado à Evolution.** Com N usuários, ela grava
o histórico de N instâncias, e esse volume de escrita cairia no banco de
produção da Freelandoo — o mesmo que atende feed, vitrine e checkout. Banco
separado também deixa a Evolution ser derrubada e recriada sem chegar perto dos
dados do produto.

Se optar por compartilhar mesmo assim: `?schema=evolution` **não é opcional**, e
o `connection_limit=5` importa mais aqui do que no Coliseu — sem teto, N
instâncias abrem N conexões e estouram o pool da aplicação.

### 3. No serviço `freelandoo-backend`

```
EVOLUTION_URL=http://evolution-api.railway.internal:8080
EVOLUTION_API_KEY=<o mesmo AUTHENTICATION_API_KEY acima>
WHATSAPP_WEBHOOK_SECRET=<openssl rand -hex 32>
```

Opcional: `WHATSAPP_IDLE_DAYS` (padrão 30; `0` desliga o sweeper da mig 224).

**Só isso.** O endereço do webhook o backend monta sozinho a partir de
`RAILWAY_PUBLIC_DOMAIN` (`https://<domínio>/webhooks/whatsapp`) e **registra na
Evolution no primeiro clique em Conectar** — não há nada a configurar na mão, e
o webhook é reaplicado a cada conexão, o que cobre instância criada fora daqui.

> **O `WHATSAPP_WEBHOOK_SECRET` é obrigatório em produção.** Sem ele a rota do
> webhook responde **503 e se recusa a funcionar**, em vez de aceitar qualquer
> corpo que chegue da internet — mesmo contrato do webhook do Stripe. Sem essa
> trava, qualquer um escreveria dentro da caixa de entrada de um usuário.

> **O webhook NÃO passa pelo proxy da Vercel.** Ele cai no Express, direto no
> Railway: é chamada de máquina, e pelo proxy pagaríamos uma invocação por
> mensagem recebida por qualquer usuário do site.

---

## O portão que sobra depois da infra

Com as ENVs setadas a aba já mostra o botão, mas o clique em **Conectar** passa
por `requirePlanFeature("whatsapp")`: a chave `whatsapp` está no plano
**Profissional** (mig 225). Sem assinatura ativa a resposta é **402** — *"Esta
função faz parte do plano Profissional"* —, não o QR.

Esse gate é de backend, e não só de tela, porque a porta que ele protege é a que
**levanta uma sessão de WhatsApp**, e sessão de pé custa memória todo dia.

Para testar sem assinar: **grant vitalício** da chave `whatsapp` por @username em
`/administracao/function-store` (a Loja tem concessão manual). O vitalício vence
o plano na ordem de posse do `PlanService.hasFeature`.

---

## Operar

- **Conectar:** `/mensagens?tab=os` → aba **WhatsApp** → *Conectar meu WhatsApp*
  → ler o QR no celular. O QR expira em ~20s e **renova sozinho a cada 18s** no
  modal; o status é conferido a cada 3s, porque o "conectou" vem do celular e
  pode não chegar por evento.
- **Conecta de vez:** lida a vez, a sessão vira um *aparelho conectado* do
  WhatsApp da pessoa, como o WhatsApp Web — fica de pé sozinha e as mensagens
  chegam por push (`messages.upsert`), sem polling. Só duas coisas a derrubam:
  **30 dias sem o dono abrir a caixa** (mig 224 — atividade é do DONO, não do
  remetente: um número pode receber todo dia e ainda assim ter sido abandonado
  aqui dentro) e **assinatura vencida**. A tela escreve o motivo
  (`disconnect_reason`), porque desconectado silencioso é indistinguível de
  defeito; reconectar limpa.
- **Derrubar a sessão não perde mensagem:** o número segue recebendo no celular
  da pessoa, e o histórico já recebido fica no nosso banco.
- **Perder o volume `/evolution/instances`** = repareamento por QR de todo
  mundo. Não perde histórico: conversas e mensagens ficam no Postgres da
  Freelandoo.
- **Ninguém é respondido automaticamente, e a garantia é estrutural:** o
  `WhatsappIngestService` **não importa** `integrations/evolution`, que é o único
  lugar que envia — não existe caminho de código de uma mensagem que chega até
  uma que sai. Toda saída nasce de um clique do dono do número.
- A **apikey é do servidor** e nunca sai do backend: nenhuma rota a devolve, nem
  para o dono da instância. O que é da pessoa é a **sessão**, que mora na
  Evolution.

## QA depois de subir

1. `/mensagens?tab=os` → as duas abas (Freelandoo · WhatsApp) aparecem.
2. Clicar em **Conectar meu WhatsApp** → o QR aparece (não mais o aviso).
3. Ler com o celular → o modal fecha sozinho e o número aparece no topo.
4. Mandar mensagem de **outro** número → a conversa aparece na lista sem
   recarregar a página (push por `whatsapp:message`).
5. Responder por ali → a resposta chega no celular.
6. Recarregar a página → continua conectado (é aqui que se vê se o volume e o
   Redis estão certos).
