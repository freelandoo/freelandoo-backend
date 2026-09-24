# Processamento de vídeo mais barato e em paralelo — desenho

Data: 2026-09-24 · Decisão do Alex: "A e B" (capacidade sempre ligada + excesso
num worker que dorme), "faça pelo seu recomendado".

## O problema, medido

Uma montagem de vídeo (`composeVideoFromFile`) passa pelo arquivo até **quatro
vezes**:

1. `probeVideoDimensions` roda `ffmpeg -i x -f null -` — **decodifica o vídeo
   inteiro** para ler largura e altura;
2. `getVideoDuration` faz a mesma coisa para ler a duração;
3. o encode;
4. se a saída passa de 50 MB, **um segundo encode inteiro** com CRF 28.

(1) e (2) estão no cabeçalho do arquivo — `ffmpeg -i x` sem saída imprime tudo
e sai em milissegundos. E todo vídeo é recodificado mesmo quando não há nada a
mudar: medido aqui, um vídeo de celular 1080x1920 sem edição **entra com 8,3 MB
e sai com 8,7 MB** — CPU gasta para devolver um arquivo maior e pior.

A fila (`mediaJobs` + `media-worker`) é **um processo, um trabalho por vez**, e
o prazo de 10 min começa a contar na ENTRADA da fila, não no início do trabalho.

Linha de base (esta máquina): 4K 30 s → 9:16 = **10,1 s**; celular 1080x1920
15 s sem edição = **2,4 s**.

## Fase 1 — agora, sem custo novo

### 1. Sondagem sem decodificar (`probeMedia`)
Uma função só, que lê o cabeçalho (`ffmpeg -hide_banner -i x`, sem saída) e
devolve `{ duration, width, height, rotation, videoCodec, pixFmt, audioCodec }`.
`probeVideoDimensions` e `getVideoDuration` passam a usá-la (mesmas
assinaturas). A leitura do texto é função pura (`parseProbe`), testada.
Semântica preservada: `Duration: N/A` continua sendo "não sei" (o webm do
MediaRecorder), e a rotação 90/270 continua trocando largura e altura.

### 2. Cópia sem recodificar quando nada muda (`canStreamCopy`)
A montagem pula o encode e faz `-c copy` quando TUDO vale:
H.264 + yuv420p, sem rotação, o recorte é o quadro inteiro e a saída tem o
tamanho da fonte (o que implica proporção exata e lado curto ≤ 1080), sem LUT,
sem grão, sem overlay, sem PiP, áudio AAC ou nenhum, duração dentro do teto e
arquivo ≤ 50 MB. Qualquer dúvida → encode, como hoje. Decisão em função pura,
testada caso a caso.

### 3. Uma passada só para caber em 50 MB
O encode ganha `-maxrate`/`-bufsize` calculados do orçamento
(`50 MB × 8 × 0,92 / segundos − áudio`). O CRF continua mandando no caso comum;
o teto só morde no vídeo longo e agitado, que é justamente o que hoje dispara o
segundo encode. O segundo encode fica como rede de segurança.

### 4. Cortar o tempo na ENTRADA
`-t` também como opção de entrada do vídeo principal: o ffmpeg para de ler no
ponto do corte em vez de decodificar o resto do arquivo.

### 5. Vários trabalhos ao mesmo tempo (pool)
`mediaJobs` sobe **N processos** em vez de um. N vem de
`MEDIA_WORKER_CONCURRENCY` ou, sem ela, da CPU **do container** (cgroup
`cpu.max`) — `os.cpus()` no Railway devolve os núcleos do HOST, e confiar nele
abriria dezenas de ffmpeg numa máquina de 8. Cada ffmpeg recebe
`-threads = núcleos / N` (via env do processo filho).

A fila passa a morar no PAI, com **prioridade**: áudio de conversa e foto
primeiro, depois vídeo de post, e aula de curso por último — e **no máximo uma
aula por vez**, para uma aula de 20 min nunca ocupar todas as vagas.

O prazo de 10 min passa a contar do **despacho** (início real). Espera na fila
tem teto próprio (15 min) e responde 503 "muitos envios agora" em vez de
pendurar a requisição.

Um processo que morre derruba só os trabalhos DELE, e só aquela vaga é reaberta.

## Fase 2 — escrita, não ligada (quando o volume pedir)

Serviço `media-worker` no Railway com `sleepApplication` (serverless),
consumindo o EXCESSO da mesma tabela `media_jobs`:

- A API, com o pool local cheio acima de um limite, sobe o original para o R2,
  grava a linha `queued` com `remote = true` e acorda o worker por HTTP na rede
  interna (o Railway acorda serviço dormindo com tráfego privado; o 1º pedido
  pode levar 502 → a API repete).
- O worker pega com `FOR UPDATE SKIP LOCKED`, processa, devolve pelo R2 e
  **fecha o pool do banco quando a fila esvazia** — conexão aberta é tráfego de
  saída e impede o sono.
- A API espera a linha virar `done` e devolve a mesma resposta de hoje: **o
  front não muda**.
- Custo parado ≈ 0; o primeiro trabalho depois do sono espera o boot (~10–20 s).
  Foi exatamente o que o Alex aceitou ("B").

Fica fora da Fase 1 porque hoje não haveria um único trabalho para ele: são 20
trabalhos na história da plataforma. O que a Fase 1 prepara: a tabela já é a
fila, e o pool já decide por prioridade.

## Testes
- Unit (puros): `parseProbe`, `canStreamCopy`, `sizeCapBitrate`,
  `containerCpus`, e o escalonador (prioridade + teto de aula).
- `test:compose` (ffmpeg real) sem regressão, mais um caso de cópia direta.
- Benchmark antes/depois com os mesmos dois arquivos.

## Resultado medido (Fase 1 entregue)

| caso | antes | depois |
|---|---|---|
| 4K 30 s → 9:16 (encode) | 10,1 s | **6,2 s** (−39%: as duas decodificações a mais sumiram) |
| celular 1080x1920 15 s sem edição | 2,4 s, 8,7 MB | **0,4 s** (−83%), 8,1 MB copiado sem perda |
| vídeo curto que chega atrás de 2 × 4K | 6,8 s | **1,1 s** (pool de 3) |

⚠️ **O POOL NÃO AUMENTA O VOLUME TOTAL, e isso foi medido, não suposto:** 3 × 4K
em paralelo levaram 9,1 s contra 9,6 s em fila — um ffmpeg sozinho já ocupa
todos os núcleos. O ganho de volume veio dos cortes de desperdício; o do pool é
de ESPERA: trabalho curto deixa de ficar preso atrás do longo. Mais volume de
verdade só com mais máquina — é a Fase 2.
