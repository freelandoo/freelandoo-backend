-- =============================================================================
-- Migration 116: Posts do blog sobre a Casa Views (formato "Cofre Cego")
-- =============================================================================
-- Conteúdo editorial explicando os sistemas/quadros do reality Casa Views.
-- Categoria "Casa Views". Idempotente: ON CONFLICT (slug) DO NOTHING.
-- Bodies em dollar-quoting ($md$...$md$). Datas escalonadas.
-- O admin pode editar e adicionar capas inline em /blog/<slug>.
-- =============================================================================

INSERT INTO public.blog_posts (slug, title, excerpt, category, tags, status, reading_minutes, seo_title, seo_description, body_md, published_at)
VALUES
(
  'casa-views-cofre-cego-o-coracao-do-jogo',
  'Cofre Cego: o coração da Casa Views',
  $ex$Todo dia alguém recebe dinheiro em segredo. Esconder, parecer normal e acumular — ou investigar, votar certo e roubar. Esse é o motor do reality.$ex$,
  'Casa Views',
  ARRAY['casa views','cofre cego','reality','mecanica'],
  'published', 5,
  'Cofre Cego: o coração da Casa Views | Freelandoo',
  'Entenda o Cofre Cego, o sistema central da Casa Views: dinheiro secreto, portador, votação e roubo.',
  $md$Toda boa história precisa de um motor. Na Casa Views, esse motor se chama **Cofre Cego** — e ele move tudo o que acontece na casa.

A ideia é simples de explicar e difícil de jogar: **todo dia, alguém recebe dinheiro em segredo.** Pode ser um participante da casa ou o Guardião da Audiência (o Top 1 do Ranking da Audiência). A partir daí, começa o jogo de esconder e caçar.

## Dois objetivos opostos

- **Quem recebe o dinheiro** quer esconder, parecer normal e acumular.
- **Todos os outros** querem investigar, votar certo e roubar.

É essa tensão — um sabe, os outros desconfiam — que cria o suspense diário.

## As regras principais

- Todo dia entra um novo valor (por exemplo, **R$ 1.000**).
- O dinheiro pode cair com um participante **ou** com o Guardião da Audiência.
- Quem está com o dinheiro **sabe** que está carregando.
- Os outros participantes **não sabem**.
- A audiência geral também não sabe — a única exceção é o Top 1, quando ele é o portador.
- À noite, **todos votam** em quem acham que está com o dinheiro.

## A hora da verdade

- Se acertarem, **roubam**.
- Se várias pessoas acertarem, **dividem** o valor.
- Se uma pessoa acertar sozinha, **leva tudo**.
- Se ninguém acertar, o portador **acumula** para o dia seguinte.

No ao vivo, **a identidade do portador nunca é revelada** — a revelação completa fica para os episódios editados. É isso que mantém o mistério aceso entre uma noite e outra.

O Cofre Cego é a base. Todos os outros quadros da casa existem para alimentar uma única pergunta: **quem está com o dinheiro hoje?**$md$,
  NOW() - INTERVAL '30 days'
),
(
  'casa-views-portador-codinome-e-mesa-do-cofre',
  'O Portador, o codinome secreto e a Mesa do Cofre',
  $ex$Quem recebe o dinheiro vira um personagem com nome secreto. E toda noite a casa se reúne para votar e tentar roubar. Conheça os dois rituais.$ex$,
  'Casa Views',
  ARRAY['casa views','cofre cego','portador','votacao'],
  'published', 5,
  'O Portador e a Mesa do Cofre na Casa Views | Freelandoo',
  'Como funciona o codinome secreto do portador e a Mesa do Cofre, o ritual diário de votação da Casa Views.',
  $md$No Cofre Cego, quem recebe o dinheiro não vira só "o portador". Vira um **personagem**. E todo fim de dia, a casa se reúne para tentar desmascará-lo.

## O codinome do portador

Sempre que alguém recebe dinheiro, precisa criar um **nome secreto**. Alguns exemplos que cabem bem no clima do jogo:

- O Fantasma do Pix
- A Máscara Dourada
- O Herdeiro Invisível
- A Cobra do Cofre
- O Traidor de Ouro
- O Anjo do Dinheiro

Por que isso importa? Porque, na live, a produção **nunca entrega a identidade**. Em vez de dizer "o Bruno perdeu o dinheiro", ela anuncia:

> "O Fantasma do Pix recebeu 5 votos e perdeu tudo. Cinco pessoas acordam R$ 200 mais ricas."

O codinome cria suspense sem revelar quem é — e transforma cada portador em uma figura que o público quer descobrir.

## A Mesa do Cofre

A **Mesa do Cofre** é o fechamento de cada dia: o momento em que todos votam secretamente.

- Cada participante vota em quem acha que está com o dinheiro.
- O voto pode ser em um participante da casa **ou** no Guardião da Audiência.
- A produção apura os votos.
- A live mostra apenas o **resultado matemático** — nunca a identidade.

Um anúncio típico soa assim:

> "Hoje o portador carregava R$ 1.000. Ele recebeu 5 votos e perdeu tudo. Cinco pessoas ganharam R$ 200 cada. A identidade será revelada apenas no episódio."

É o ritual que fecha o dia, distribui o dinheiro e abre as feridas que vão alimentar o jogo de amanhã.$md$,
  NOW() - INTERVAL '27 days'
),
(
  'casa-views-ranking-da-audiencia-e-o-guardiao',
  'A audiência vira jogadora: Ranking e o Guardião da Audiência',
  $ex$O público não entra como massa anônima. Comentários, likes e palpites viram pontos — e o Top 1 ganha um lugar dentro do jogo: o Guardião da Audiência.$ex$,
  'Casa Views',
  ARRAY['casa views','audiencia','ranking','guardiao'],
  'published', 5,
  'Ranking da Audiência e o Guardião — Casa Views | Freelandoo',
  'Como a audiência da Casa Views vira jogadora: pontuação por engajamento e o papel do Guardião da Audiência (Top 1).',
  $md$Na maioria dos realities, o público assiste de fora. Na Casa Views, **a audiência entra no jogo** — e o melhor de todos ganha um assento à mesa.

## O Ranking da Audiência

A ideia é transformar engajamento em poder. Cada interação no conteúdo oficial vale pontos. Uma pontuação sugerida:

- Comentário válido no post oficial: **+1**
- Like recebido no seu comentário: **+1** (com limite)
- Resposta recebida: **+1** a cada 10 respostas
- Palpite registrado no app: **+5**
- Check-in na live: **+3**
- Participação em enquete: **+2**
- Acertar a previsão do Cofre: **+10**
- Comentário removido por spam/ofensa: **perde pontos**

Quem chega ao topo desse ranking vira o **Guardião da Audiência**.

## O Guardião da Audiência (Top 1)

A audiência não age como massa aberta: o representante dela é o **Top 1**. E aqui está a virada — **se o dinheiro cair com a audiência, só o Top 1 sabe.**

A função do Guardião é jogar pelo público:

- Guardar segredo.
- Manipular teorias.
- Participar de chamadas de investigação.
- Tentar fazer os participantes votarem errado.
- Defender o Cofre da Audiência.
- Acumular dinheiro para o público.

E há um risco delicioso: **se o Guardião divulgar que está com o dinheiro, ele se prejudica** — vira alvo e pode perder tudo na Mesa do Cofre. Ou seja, o público não só torce: o público blefa.$md$,
  NOW() - INTERVAL '24 days'
),
(
  'casa-views-ranking-dos-participantes-poder-na-casa',
  'Ranking dos Participantes: o poder dentro da casa',
  $ex$Dentro da casa, performance vira poder. O ranking de visualizações e engajamento define líderes, tarefas, dicas e quem leva vantagem na Mesa do Cofre.$ex$,
  'Casa Views',
  ARRAY['casa views','ranking','participantes','poder'],
  'published', 4,
  'Ranking dos Participantes na Casa Views | Freelandoo',
  'Como o Ranking dos Participantes transforma visualizações e engajamento em poder real dentro da Casa Views.',
  $md$Se o Cofre Cego é sobre dinheiro escondido, o **Ranking dos Participantes** é sobre poder à mostra. Ele transforma a performance de cada um — visualizações e engajamento — em **vantagem concreta** dentro da casa.

## Performance vira poder

O ranking funciona como uma disputa contínua. Quanto mais um participante engaja e atrai audiência, mais alto ele sobe — e mais influência ganha sobre o jogo.

Entre as funções que a posição no ranking pode liberar:

- Definir os **líderes do dia**.
- Distribuir tarefas.
- Dar direito a **dicas**.
- Liberar poderes de investigação.
- Definir quem tem **vantagem na Mesa do Cofre**.
- Criar uma hierarquia de poder dentro da casa.

## Exemplo de recompensas por posição

- **1º lugar:** Dica Ouro
- **2º lugar:** Dica Prata
- **3º lugar:** Dica Bronze
- **Últimos colocados:** sem dica — ou com punição

O resultado é uma casa onde ninguém pode relaxar: cair no ranking significa perder informação justamente quando ela vale mais. É a engrenagem que recompensa quem entrega conteúdo e mantém todo mundo em movimento.$md$,
  NOW() - INTERVAL '21 days'
),
(
  'casa-views-caixinha-feedback-hate-or-like',
  'Caixinha de Segredos, Feedback Sincero e Hate or Like',
  $ex$Os quadros que mexem com percepção e alianças: segredos anônimos, a leitura do público e as plácas de elogio ou crítica entre os participantes.$ex$,
  'Casa Views',
  ARRAY['casa views','intriga','percepcao','aliancas'],
  'published', 5,
  'Caixinha de Segredos, Feedback Sincero e Hate or Like | Casa Views',
  'Os quadros de intriga social da Casa Views: Caixinha de Segredos, Feedback Sincero e Hate or Like.',
  $md$O Cofre Cego se decide no voto — e o voto se decide na **percepção**. Por isso a Casa Views tem um arsenal de quadros feitos para plantar dúvida, expor opinião e bagunçar alianças.

## Caixinha de Segredos

Cada participante escreve, **de forma anônima**, elogios, críticas ou observações sobre alguém da casa. É a ferramenta clássica para mexer com alianças, percepção e curiosidade do público.

Dentro do Cofre, ela vira uma arma:

- Plantar suspeitas.
- Criar acusações.
- Gerar pistas emocionais.
- Alimentar o Tribunal do Cofre.
- Fazer alguém **parecer culpado mesmo sem estar**.

## Feedback Sincero

Aqui quem fala é o público. A produção reúne os comentários recorrentes da audiência e apresenta para os participantes. O efeito é poderoso:

- Mostra como o público está lendo cada pessoa.
- Cria desconforto.
- Força reação.
- Influencia as suspeitas sobre quem está rico, mentindo ou manipulando.

## Hate or Like

Cada participante usa placas (ou adjetivos) positivos e negativos para definir os colegas. Simples e explosivo:

- Gera conflito.
- Expõe a opinião real.
- Cria ressentimento.
- Alimenta suspeitas sobre alianças e votos.

Juntos, esses três quadros fazem o trabalho sujo do jogo: transformam impressão em acusação — e acusação em voto.$md$,
  NOW() - INTERVAL '18 days'
),
(
  'casa-views-sabotador-e-mafia-views',
  'O Sabotador e a Máfia Views: caos, mentira e blefe',
  $ex$Um participante secreto espalha o caos. Um jogo social expõe quem mente mal. Duas mecânicas feitas para envenenar a Mesa do Cofre.$ex$,
  'Casa Views',
  ARRAY['casa views','sabotador','mafia','blefe'],
  'published', 4,
  'O Sabotador e a Máfia Views na Casa Views | Freelandoo',
  'Como o Sabotador e o jogo Máfia Views injetam caos, mentira e blefe na Casa Views.',
  $md$Se a casa votasse sempre com clareza, o Cofre Cego seria fácil. Para garantir que não seja, entram duas peças desenhadas para envenenar o jogo: o **Sabotador** e a **Máfia Views**.

## O Sabotador

O Sabotador é um **participante secreto** cuja missão é criar caos. Adaptado ao Cofre, ele ganha um repertório perigoso:

- Espalhar suspeitas falsas.
- Tentar proteger o portador.
- Fazer a casa votar errado.
- Ganhar bônus se **ninguém descobrir o portador**.
- Ser confundido com quem está com o dinheiro.

Ou seja: parte do que parece "investigação" pode ser sabotagem disfarçada. E ninguém sabe ao certo de quem.

## Máfia Views

A Máfia Views é um jogo social de **acusação, mentira e blefe**. Dentro da Casa Views, ele serve para:

- Treinar a leitura social dos participantes.
- Criar alianças.
- Expor quem mente mal.
- Gerar cortes de acusação para o conteúdo.
- Alimentar suspeitas que vão parar na Mesa do Cofre.

Os dois se completam: o Sabotador injeta o caos, a Máfia Views revela quem sabe (ou não sabe) navegar nele. O resultado é uma casa onde a verdade é a moeda mais rara.$md$,
  NOW() - INTERVAL '15 days'
),
(
  'casa-views-bunker-views-cartas-de-poder',
  'Bunker Views: as cartas de poder do Cofre',
  $ex$Votação secreta, blefe, negociação e ações surpresa. As cartas do Bunker Views podem ser adaptadas para virar poderes dentro do Cofre Cego.$ex$,
  'Casa Views',
  ARRAY['casa views','bunker','cartas','poderes'],
  'published', 4,
  'Bunker Views: cartas de poder do Cofre | Casa Views',
  'Como as cartas do Bunker Views (voto duplo, blindagem, hackear votos) viram poderes no Cofre Cego da Casa Views.',
  $md$O **Bunker Views** já nasce com tudo o que o Cofre Cego adora: mecânica de cartas, votação secreta, blefe, negociação, ações surpresa e eliminação simbólica. Por isso ele funciona tão bem como **quadro para liberar poderes**.

## Cartas que viram poder

Cada carta do Bunker pode ser adaptada para alterar o rumo de uma noite no Cofre:

- **Voto Duplo** — seu voto conta por dois.
- **Blindagem** — proteção contra um efeito ou acusação.
- **Expor Segredo** — revela uma informação escondida.
- **Hackear Votos** — interfere no resultado da votação.
- **Silêncio** — impede alguém de falar ou influenciar.
- **Troca Forçada** — obriga uma troca entre participantes.
- **Chave do Bunker** — a carta-curinga do jogo.

## Por que isso potencializa o Cofre

Poderes mudam a matemática da Mesa do Cofre. Um Voto Duplo bem usado rouba sozinho; uma Blindagem salva o portador na última hora; um Hackear Votos transforma certeza em armadilha.

Adaptadas ao Cofre Cego, as cartas do Bunker adicionam a camada de **estratégia imprevisível** — aquele momento em que o jogo vira de cabeça para baixo e ninguém viu chegando.$md$,
  NOW() - INTERVAL '12 days'
),
(
  'casa-views-presidente-quiz-liquido-robo-view',
  'Presidente Views, Quiz com Líquido e Robo View: os quadros de show',
  $ex$Nem tudo é tensão e dinheiro escondido. Os quadros de humor, punição visual e avatar que geram os cortes virais da Casa Views.$ex$,
  'Casa Views',
  ARRAY['casa views','humor','quadros','conteudo'],
  'published', 4,
  'Presidente Views, Quiz com Líquido e Robo View | Casa Views',
  'Os quadros de show da Casa Views: Presidente Views, Quiz com Líquido e Robo View — humor e cortes virais.',
  $md$Um reality não vive só de tensão. Para respirar (e gerar os cortes que viralizam), a Casa Views tem seus **quadros de show** — leves, cômicos e desenhados para o público compartilhar.

## Presidente Views

Uma campanha política absurda e cômica: os participantes fazem promessas falsas, discursos e campanhas para convencer a audiência. Serve para:

- Gerar humor.
- Criar rivalidade.
- Testar a persuasão de cada um.
- Mostrar quem manipula melhor (informação valiosa para o Cofre).
- Render vídeos para o ranking.

## Quiz com Líquido

Um quadro de **punição visual**: respostas erradas geram punições molhadas e situações engraçadas. Por que funciona:

- Gera cortes virais.
- Quebra a tensão da casa.
- Cria uma humilhação leve e divertida.
- Pode distribuir vantagens ou dicas do Cofre.

## Robo View

Cada participante cria um **robô/avatar** com cores e recebe uma leitura divertida de personalidade. É o quadro mais leve:

- Conteúdo descontraído.
- Ativação de marca.
- Interação com QR Code.
- Material para cortes e para a votação do público.

Esses três quadros equilibram o jogo: depois de uma noite pesada na Mesa do Cofre, é o humor que mantém a casa (e a audiência) com fôlego para o próximo dia.$md$,
  NOW() - INTERVAL '9 days'
),
(
  'casa-views-conveniencia-views-publico-no-jogo',
  'Conveniência Views: quando o público entra no jogo',
  $ex$A audiência não só assiste: ela compra mimos, desafios e recados que mexem com os participantes — e ainda gera receita paralela para o reality.$ex$,
  'Casa Views',
  ARRAY['casa views','conveniencia','audiencia','interacao'],
  'published', 4,
  'Conveniência Views: o público entra no jogo | Casa Views',
  'Como a Conveniência Views deixa o público enviar produtos, desafios e recados que influenciam o jogo da Casa Views.',
  $md$Na Casa Views, a audiência tem dinheiro, voz — e agora **mão dentro da casa**. É a **Conveniência Views**, o sistema em que o público compra mimos, desafios ou interações para os participantes.

## O que o público pode fazer

A Conveniência Views permite que a audiência envie **produtos, desafios e vídeo-recados** para quem está na casa. No formato do Cofre, isso vira estratégia:

- Mandar um desafio direto para um suspeito.
- Forçar alguém a responder perguntas.
- Fazer participantes se exporem.
- Criar recompensas e punições sob demanda.
- Gerar **receita paralela** para o reality.

## Por que isso muda o jogo

Quando o público pode empurrar um participante para o centro da arena, a investigação deixa de depender só da casa. Um desafio bem colocado obriga o portador a improvisar, escorregar — e talvez se entregar.

É o último elo do desenho da Casa Views: a audiência pontua (Ranking), representa (Guardião) e agora **interfere** (Conveniência). O público deixou de ser plateia. Virou jogador.$md$,
  NOW() - INTERVAL '6 days'
)
ON CONFLICT (slug) DO NOTHING;
