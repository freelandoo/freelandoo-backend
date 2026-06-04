-- =============================================================================
-- Migration 115: Seed inicial do blog (12 guias práticos)
-- =============================================================================
-- Conteúdo editorial inicial. Guias úteis ao leitor (não propaganda), que dão
-- substância ao site para SEO e para a revisão do Google AdSense.
-- Idempotente: ON CONFLICT (slug) DO NOTHING — não sobrescreve edições do admin.
-- Bodies em dollar-quoting ($md$...$md$) para markdown com aspas sem escape.
-- Datas escalonadas (published_at) para um histórico natural.
-- =============================================================================

INSERT INTO public.blog_posts (slug, title, excerpt, category, tags, status, reading_minutes, seo_title, seo_description, body_md, published_at)
VALUES
(
  'como-criar-perfil-profissional-que-fecha-clientes',
  'Como criar um perfil profissional que fecha clientes',
  $ex$Seu perfil é a sua vitrine. Veja o passo a passo para montar um perfil que transmite confiança e converte visitantes em clientes.$ex$,
  'Primeiros passos',
  ARRAY['perfil','primeiros passos','conversão'],
  'published', 6,
  'Como criar um perfil profissional que fecha clientes | Freelandoo',
  'Passo a passo para montar um perfil profissional que transmite confiança e converte visitantes em clientes na Freelandoo.',
  $md$Seu perfil é a primeira coisa que um cliente vê — e, na maioria das vezes, é o que decide se ele vai te chamar ou seguir rolando a tela. Um bom perfil não precisa ser bonito: precisa ser **claro, específico e confiável**. Veja como construir o seu.

## 1. Escolha uma foto que passe profissionalismo

Use uma foto nítida, com boa luz e que mostre seu rosto (ou, no caso de um serviço visual, um trabalho seu de destaque). Evite fotos cortadas de grupo, imagens escuras ou logos genéricos. Pessoas contratam pessoas — quando dá pra ver quem está do outro lado, a confiança aumenta.

## 2. Escreva uma descrição que responde "o que você resolve"

O erro mais comum é escrever só o cargo: "designer", "eletricista", "social media". Isso não diz nada ao cliente. Em vez disso, descreva **o problema que você resolve e para quem**:

- Ruim: "Sou designer gráfico."
- Bom: "Crio identidade visual e posts para pequenos negócios que querem parecer profissionais sem gastar uma fortuna."

## 3. Use subperfis para separar o que você faz

Se você atua em mais de uma área, crie um subperfil para cada uma. Assim, quem procura um fotógrafo encontra o seu lado fotógrafo — e não uma página confusa misturando cinco serviços. Cada subperfil tem sua própria profissão, portfólio e avaliações.

## 4. Mostre provas, não promessas

Nada vende mais do que resultado. Preencha seu portfólio com trabalhos reais, mesmo que poucos. Três bons exemplos valem mais que vinte medianos. Se você está começando e ainda não tem clientes, faça projetos pessoais ou voluntários para ter o que mostrar.

## 5. Mantenha tudo atualizado

Um perfil parado passa a impressão de que você sumiu. Atualize o portfólio, responda mensagens rápido e mantenha sua disponibilidade em dia. Clientes tendem a escolher quem responde primeiro.

## Checklist final

- [ ] Foto nítida e profissional
- [ ] Descrição que diz o que você resolve e para quem
- [ ] Um subperfil por área de atuação
- [ ] Portfólio com pelo menos 3 trabalhos
- [ ] Contato e disponibilidade atualizados

Comece simples. Um perfil honesto e bem preenchido já te coloca à frente da maioria.$md$,
  NOW() - INTERVAL '40 days'
),
(
  'portfolio-que-vende-como-organizar-seus-trabalhos',
  'Portfólio que vende: como organizar seus melhores trabalhos',
  $ex$Ter trabalhos bons não basta — é preciso apresentá-los do jeito certo. Aprenda a montar um portfólio que convence.$ex$,
  'Conteúdo e audiência',
  ARRAY['portfólio','conversão','imagem'],
  'published', 6,
  'Portfólio que vende: como organizar seus trabalhos | Freelandoo',
  'Aprenda a montar um portfólio que apresenta seus melhores trabalhos do jeito certo e converte mais clientes.',
  $md$Um portfólio não é uma galeria de tudo que você já fez — é uma **seleção estratégica** do que prova que você é capaz de resolver o problema do cliente. Mais trabalho nem sempre é melhor.

## Qualidade acima de quantidade

Três projetos excelentes comunicam mais do que vinte medianos. Cada peça fraca puxa a média da sua imagem para baixo. Pergunte-se em cada trabalho: "isso me faria ser contratado?". Se a resposta for "mais ou menos", deixe de fora.

## Conte a história por trás do trabalho

Uma imagem sozinha mostra o "o quê". O que vende é o "porquê" e o "como". Sempre que possível, descreva:

- Qual era o desafio ou pedido do cliente
- O que você fez
- Qual foi o resultado (mais vendas, mais seguidores, um problema resolvido)

Isso transforma uma foto bonita em uma prova de competência.

## Cuide da apresentação visual

- Use imagens com boa resolução e enquadramento limpo.
- Mantenha um padrão visual entre as peças (mesma proporção, fundo neutro).
- Coloque seu melhor trabalho primeiro — muita gente decide nos primeiros segundos.

## Atualize com frequência

Um portfólio vivo mostra que você está ativo e evoluindo. Sempre que terminar um bom projeto, substitua o mais fraco da lista. Assim, sua vitrine só melhora com o tempo.

## Não tem clientes ainda? Crie projetos

Quem está começando pode montar um portfólio com projetos pessoais, recriações ou trabalhos voluntários. O cliente quer ver que você sabe fazer — ele não precisa saber se foi pago por aquilo.

Seu portfólio é o seu melhor vendedor, trabalhando 24 horas por dia. Vale o tempo de montá-lo com cuidado.$md$,
  NOW() - INTERVAL '37 days'
),
(
  'como-precificar-servicos-como-freelancer-no-brasil',
  'Como precificar seus serviços como freelancer no Brasil',
  $ex$Cobrar pouco demais cansa; cobrar demais afasta. Veja um método simples para chegar a um preço justo e lucrativo.$ex$,
  'Vender serviços',
  ARRAY['preço','serviços','finanças'],
  'published', 7,
  'Como precificar serviços como freelancer no Brasil | Freelandoo',
  'Método simples para definir o preço dos seus serviços como freelancer, cobrindo custos, impostos e seu tempo.',
  $md$Definir preço é uma das partes mais difíceis de trabalhar por conta própria. Cobre pouco e você trabalha muito para ganhar pouco. Cobre demais sem justificar e perde clientes. A boa notícia: dá para chegar a um número justo com um método simples.

## 1. Descubra quanto você precisa ganhar por mês

Some seus custos de vida e os custos do trabalho (internet, equipamentos, softwares, transporte). Esse é o piso: abaixo disso, você está pagando para trabalhar.

## 2. Calcule suas horas realmente faturáveis

Você não vende 8 horas por dia. Parte do tempo vai para prospecção, orçamentos, e-mails e administração. Na prática, muitos freelancers faturam de 4 a 5 horas por dia. Use esse número real.

> Renda desejada ÷ horas faturáveis no mês = seu valor-hora base.

## 3. Não esqueça os impostos e a margem

Sobre o valor-hora base, acrescente uma reserva para impostos e uma margem de segurança para imprevistos e férias (afinal, freelancer não tem 13º nem férias pagas). Uma margem saudável evita que cada imprevisto vire prejuízo.

## 4. Prefira preço por projeto, não por hora

Cobrar por hora pune quem é rápido e bom. Sempre que possível, estime as horas que o projeto vai levar e feche um **valor fechado**. O cliente prefere saber o total, e você é recompensado pela sua eficiência.

## 5. Teste e ajuste

Se todos os clientes aceitam seu preço na hora, provavelmente você está barato. Se quase ninguém fecha, pode estar caro **ou** o problema é a forma de apresentar o valor. Ajuste aos poucos e observe.

## Um detalhe sobre taxas

Em qualquer plataforma ou meio de pagamento existem taxas (maquininha, intermediação). Defina sempre o valor que **você quer receber líquido** e deixe o preço final ao cliente refletir isso — assim você nunca recebe menos do que planejou.

Preço não é chute. É conta. Faça a sua e cobre com confiança.$md$,
  NOW() - INTERVAL '34 days'
),
(
  'agenda-online-como-receber-agendamentos-sem-dor-de-cabeca',
  'Agenda online: como receber agendamentos sem dor de cabeça',
  $ex$Trocar mensagens para marcar horário cansa os dois lados. Veja como uma agenda online organiza sua semana e reduz furos.$ex$,
  'Vender serviços',
  ARRAY['agenda','agendamento','organização'],
  'published', 5,
  'Agenda online: receba agendamentos sem dor de cabeça | Freelandoo',
  'Como usar uma agenda online com sinal de reserva para organizar seus horários e reduzir furos de clientes.',
  $md$Quem trabalha com hora marcada conhece a rotina: dezenas de mensagens só para encaixar um horário, confusão de fuso, e o clássico cliente que marca e não aparece. Uma agenda online resolve boa parte disso.

## Deixe o cliente ver seus horários livres

Em vez de ficar respondendo "que dia é melhor para você?", publique seus horários disponíveis. O cliente escolhe o que encaixa na agenda dele e confirma. Menos mensagens, menos retrabalho.

## Use um sinal para confirmar a reserva

O maior inimigo de quem agenda é o "não comparecimento". Pedir um **sinal** (um valor pago na hora de marcar) muda o jogo: quem paga, aparece. O sinal também demonstra compromisso e protege o seu tempo, que é o seu produto mais valioso.

## Defina a duração de cada serviço

Cadastre quanto dura cada tipo de atendimento. Assim, o sistema bloqueia o tempo certo e evita que dois clientes caiam no mesmo horário. Nada pior do que dois agendamentos sobrepostos.

## Confirmação e lembrete

Um agendamento confirmado por escrito, com data, horário e valor, evita mal-entendidos. O cliente sabe exatamente o que esperar, e você tem um registro de tudo.

## Organize a semana, não só o dia

Olhar a semana inteira ajuda a equilibrar a carga: evitar dias lotados seguidos de dias vazios, reservar tempo para deslocamento e respeitar suas pausas. Agenda boa não é a mais cheia — é a mais sustentável.

Automatizar o agendamento libera sua cabeça para o que importa: fazer um bom trabalho. O cliente marca sozinho, paga o sinal, e você só aparece para entregar.$md$,
  NOW() - INTERVAL '31 days'
),
(
  'vender-produtos-fisicos-guia-do-frete-e-etiqueta',
  'Vendendo produtos físicos: o guia do frete e da etiqueta',
  $ex$Frete assusta quem está começando a vender produtos. Entenda como funciona o cálculo, a etiqueta e o que cuidar no envio.$ex$,
  'Vender produtos',
  ARRAY['loja','frete','produtos'],
  'published', 6,
  'Vender produtos físicos: guia do frete e da etiqueta | Freelandoo',
  'Entenda como funciona o cálculo de frete, a etiqueta de envio e os cuidados ao vender produtos físicos online.',
  $md$Vender produto físico assusta no começo por causa de uma palavra: frete. Mas, entendendo o básico, ele deixa de ser um bicho de sete cabeças.

## O frete é calculado por peso e dimensões

Transportadoras cobram com base no **peso** e no **tamanho** da embalagem, além da distância. Por isso, ao cadastrar um produto, informe corretamente:

- Peso (com a embalagem)
- Altura, largura e comprimento da caixa

Dados errados aqui geram cobranças erradas — e prejuízo no seu bolso.

## O cliente vê o frete antes de comprar

Na hora da compra, o sistema calcula o frete até o CEP do cliente e mostra as opções (mais rápida ou mais barata). O cliente escolhe e paga junto. Sem surpresa para nenhum dos dois.

## A etiqueta pode ser automática

Depois da venda paga, a etiqueta de envio pode ser gerada automaticamente. Você só imprime, cola na caixa e despacha. Isso elimina filas e o trabalho manual de preencher dados de envio um por um.

## Embalagem importa

Produto que chega quebrado vira devolução e avaliação ruim. Invista em uma embalagem adequada:

- Proteja itens frágeis com plástico-bolha
- Use caixa do tamanho certo (sobra demais = produto se mexe)
- Lacre bem e identifique com a etiqueta legível

## Acompanhe o envio

Guarde o código de rastreio e acompanhe a entrega. Se algo travar nos Correios ou na transportadora, você consegue agir antes de o cliente reclamar. Proatividade evita dor de cabeça.

Vender produto online é totalmente viável para quem está começando. Com peso e dimensões certos, etiqueta automática e boa embalagem, o envio vira rotina — e você foca em vender mais.$md$,
  NOW() - INTERVAL '28 days'
),
(
  'stories-e-bees-como-usar-video-curto-para-atrair-clientes',
  'Stories e Bees: como usar vídeo curto para atrair clientes',
  $ex$Vídeo curto é a forma mais rápida de mostrar quem você é e o que faz. Veja como usar a seu favor — sem ser influencer.$ex$,
  'Conteúdo e audiência',
  ARRAY['vídeo','stories','bees','marketing'],
  'published', 5,
  'Stories e Bees: vídeo curto para atrair clientes | Freelandoo',
  'Como usar vídeos curtos (Stories e Bees) para mostrar seu trabalho e atrair clientes, mesmo sem ser influenciador.',
  $md$Você não precisa ser influenciador para usar vídeo a seu favor. Vídeo curto é, hoje, a forma mais rápida de um cliente entender quem você é, como você trabalha e por que confiar em você.

## Por que vídeo funciona tão bem

Texto e foto mostram o resultado. Vídeo mostra o **processo** e a **pessoa**. Ver alguém trabalhando, explicando ou entregando cria uma conexão que a foto sozinha não cria. E conexão é o que faz o cliente escolher você em vez do concorrente.

## Stories: o dia a dia que gera proximidade

Os Stories são perfeitos para o cotidiano: um trabalho em andamento, um bastidor, uma dica rápida. Eles somem em 24 horas, então não precisam ser perfeitos — precisam ser **reais**. Esse é justamente o charme.

## Bees: o conteúdo que fica e alcança mais

Os Bees são vídeos verticais que ficam no seu perfil e no feed, alcançando mais gente ao longo do tempo. Use-os para conteúdos que valem a pena reassistir: um antes e depois, um tutorial curto, a apresentação de um serviço.

## 4 ideias de vídeo que sempre funcionam

1. **Antes e depois** — mostra resultado de forma instantânea.
2. **Bastidor** — como você faz, do começo ao fim.
3. **Dica rápida** — ensine algo útil em 30 segundos.
4. **Depoimento** — um cliente satisfeito falando (com permissão).

## Dicas práticas de gravação

- Grave na vertical e com boa luz (de preferência natural).
- Fale direto ao ponto nos primeiros 3 segundos.
- Legenda ajuda: muita gente assiste sem som.
- Não precisa de equipamento caro — o celular basta.

Constância vale mais que perfeição. Poucos vídeos por semana, com regularidade, constroem presença e trazem clientes que já chegam confiando em você.$md$,
  NOW() - INTERVAL '25 days'
),
(
  'o-que-e-o-enxame-e-como-ele-te-conecta-ao-cliente-certo',
  'O que é o Enxame e como ele te conecta ao cliente certo',
  $ex$O Enxame organiza profissões por afinidade para que o cliente certo encontre você. Entenda como funciona e como aparecer.$ex$,
  'Primeiros passos',
  ARRAY['enxame','vitrine','descoberta'],
  'published', 5,
  'O que é o Enxame e como ele te conecta ao cliente certo | Freelandoo',
  'Entenda o que é o Enxame da Freelandoo, como ele organiza profissões e como aparecer para o cliente certo.',
  $md$Encontrar o profissional certo costuma ser difícil porque tudo fica misturado. O Enxame existe para resolver isso: ele agrupa profissões por afinidade, de forma que o cliente navegue por área e chegue exatamente em quem resolve o problema dele.

## A ideia por trás do Enxame

Em vez de uma lista gigante e genérica, as profissões ficam organizadas em grupos temáticos — os enxames. Quem procura um serviço entra no enxame relacionado e encontra profissionais alinhados àquela necessidade. Menos ruído, mais encontro certo.

## Por que isso é bom para você

Aparecer para "todo mundo" é o mesmo que aparecer para ninguém. Estar no enxame certo significa ser encontrado por quem **realmente** procura o que você faz — ou seja, por clientes com mais intenção de fechar. Visibilidade qualificada vale mais que visibilidade em massa.

## Como aparecer bem no seu enxame

- **Escolha a profissão certa** no seu subperfil. É ela que define onde você aparece.
- **Preencha tudo**: perfis completos transmitem confiança e tendem a ser priorizados.
- **Mantenha-se ativo**: quem posta, responde e atualiza tende a ganhar relevância.
- **Reúna boas avaliações**: prova social pesa na hora da escolha.

## Pense como o cliente

Antes de definir sua profissão e descrição, pergunte: "se eu fosse o cliente, qual palavra eu digitaria para encontrar esse serviço?". Use essa linguagem. Quanto mais você fala como o cliente pensa, mais fácil ele te acha.

O Enxame é o caminho entre o seu trabalho e quem precisa dele. Posicione-se no lugar certo e deixe o cliente certo chegar até você.$md$,
  NOW() - INTERVAL '22 days'
),
(
  'clans-como-montar-um-time-e-dividir-ganhos',
  'Clãs: como montar um time e dividir ganhos com transparência',
  $ex$Sozinho você vai mais rápido; em time, mais longe. Veja como os Clãs ajudam profissionais a trabalhar juntos.$ex$,
  'Comunidade',
  ARRAY['clãs','time','colaboração'],
  'published', 6,
  'Clãs: como montar um time e dividir ganhos | Freelandoo',
  'Entenda como os Clãs permitem reunir profissionais em um time, atender projetos maiores e dividir ganhos com transparência.',
  $md$Tem trabalho que é grande demais para uma pessoa só. Um casamento que precisa de fotógrafo, filmmaker e DJ. Uma reforma que junta pedreiro, eletricista e pintor. Os Clãs existem para isso: reunir profissionais em um time que atende junto.

## O que é um Clã

Um Clã é um perfil coletivo: vários profissionais associados sob um mesmo nome. O cliente contrata o time, e cada membro contribui com a sua especialidade. É a forma de oferecer um serviço completo sem que ninguém precise dominar tudo sozinho.

## Quando vale a pena formar um Clã

- Você recebe pedidos que exigem mais de uma especialidade.
- Você quer oferecer um pacote completo ao cliente.
- Você confia em outros profissionais e quer crescer junto.

## A chave é a transparência na divisão

O ponto mais delicado de trabalhar em grupo é o dinheiro. Por isso, defina **antes** como os ganhos serão divididos em cada tipo de trabalho. Regras claras desde o início evitam desconforto depois — e mantêm o time unido por muito tempo.

## Monte o time com critério

Um Clã é tão bom quanto seus membros. Escolha gente que:

- Entrega com qualidade e no prazo
- Se comunica bem
- Compartilha do mesmo padrão de atendimento

Um único membro relapso afeta a reputação do time inteiro.

## Some reputações

Trabalhando juntos, vocês acumulam avaliações como time e fortalecem a imagem coletiva. Um Clã com histórico sólido passa muito mais segurança a um cliente do que profissionais soltos negociando separadamente.

Sozinho você atende um projeto; em time, você atende projetos que antes nem chegavam até você. Os Clãs são o caminho para pensar grande sem perder a confiança que vem do trabalho bem-feito.$md$,
  NOW() - INTERVAL '19 days'
),
(
  'cursos-como-transformar-seu-conhecimento-em-renda',
  'Cursos: como transformar seu conhecimento em renda',
  $ex$Você sabe algo que outras pessoas querem aprender. Veja como organizar esse conhecimento em um curso que vende.$ex$,
  'Monetização',
  ARRAY['cursos','conhecimento','renda'],
  'published', 6,
  'Cursos: como transformar seu conhecimento em renda | Freelandoo',
  'Aprenda a organizar o que você sabe em um curso online que gera renda recorrente, do planejamento à publicação.',
  $md$Se você domina um ofício, provavelmente há gente disposta a pagar para aprender com você. Transformar conhecimento em curso é uma das formas mais inteligentes de gerar renda: você cria uma vez e vende muitas vezes.

## Comece pelo problema, não pelo conteúdo

O erro clássico é montar um curso sobre "tudo que eu sei". O aluno não quer tudo — ele quer **resolver um problema específico**. Escolha uma transformação clara: "do zero ao primeiro corte de cabelo profissional", "como editar suas fotos no celular". Quanto mais específico, mais fácil vender.

## Estruture em módulos e aulas

Divida o aprendizado em passos lógicos. Cada módulo é uma etapa; cada aula, um pedaço pequeno e digerível. Um aluno que avança aula a aula sente progresso — e quem sente progresso conclui e recomenda.

## Não precisa de produção de cinema

Aula boa é aula que ensina. Áudio limpo e tela legível importam mais do que câmera cara. Grave em um ambiente silencioso, com boa luz, e foque na clareza da explicação.

## Defina um preço justo

Lembre-se de que você está vendendo um resultado, não minutos de vídeo. Pense no valor que a transformação entrega ao aluno. E, ao definir o preço, considere que o valor que você quer receber é o que conta — taxas existem em qualquer plataforma e já entram no cálculo do que o aluno paga.

## Renda que se acumula

A grande vantagem do curso é a escala. Diferente de um serviço (uma hora sua = um cliente), um curso pode ser vendido para dezenas de pessoas sem trabalho extra a cada venda. É o seu conhecimento trabalhando por você.

Você já tem o conteúdo — está na sua experiência. Organizá-lo em um curso é o que transforma o que está na sua cabeça em uma fonte de renda que não para.$md$,
  NOW() - INTERVAL '16 days'
),
(
  'programa-de-afiliados-como-ganhar-indicando',
  'Programa de afiliados: como ganhar indicando a Freelandoo',
  $ex$Indicar quem você já indicaria de graça pode virar renda. Entenda como funciona o programa de afiliados.$ex$,
  'Monetização',
  ARRAY['afiliados','indicação','renda extra'],
  'published', 5,
  'Programa de afiliados: ganhe indicando | Freelandoo',
  'Entenda como funciona o programa de afiliados da Freelandoo e como gerar renda indicando a plataforma com o seu cupom.',
  $md$Você provavelmente já recomenda ferramentas e serviços para amigos sem ganhar nada por isso. O programa de afiliados transforma essas indicações naturais em renda.

## Como funciona, em resumo

Você recebe um cupom (um código ligado a você). Quando alguém usa esse cupom ao contratar algo na plataforma, parte do valor vira **comissão sua**. Simples assim: você indica, a pessoa fecha, você ganha.

## Por que isso é interessante

- Não exige produzir produto nem prestar serviço.
- Funciona com o que você já faz: falar bem de algo que usa.
- A comissão entra de forma recorrente, conforme suas indicações fecham.

## Como divulgar de forma honesta

A melhor divulgação é a verdadeira. Em vez de espalhar o cupom para qualquer um, compartilhe com quem realmente se beneficiaria:

- Colegas de profissão que querem uma vitrine
- Pessoas que pedem indicação de profissionais
- Sua audiência, se você cria conteúdo

Recomendação honesta converte mais e constrói reputação. Spam queima sua imagem.

## Acompanhe seus resultados

Vale acompanhar quantas pessoas usaram seu cupom e quanto você já acumulou. Isso ajuda a entender o que funciona — qual canal traz mais gente, qual mensagem convence — e a fazer mais do que dá certo.

## Um detalhe sobre prazos

Comissões costumam ter um período de confirmação antes de ficarem disponíveis (uma proteção natural contra cancelamentos e devoluções). Saber disso evita ansiedade: o valor aparece, amadurece e então fica liberado.

Indicar é algo que você já faz. O programa de afiliados só coloca recompensa em cima disso. Comece pelas pessoas que você indicaria de qualquer jeito.$md$,
  NOW() - INTERVAL '12 days'
),
(
  'polens-a-moeda-interna-e-como-usar-a-seu-favor',
  'Poléns: a moeda interna e como usá-la a seu favor',
  $ex$Os Poléns são créditos internos que dão acesso a recursos da plataforma. Entenda o que são e como aproveitá-los.$ex$,
  'Monetização',
  ARRAY['poléns','créditos','recursos'],
  'published', 4,
  'Poléns: a moeda interna e como usar a seu favor | Freelandoo',
  'Entenda o que são os Poléns, a moeda interna da Freelandoo, e como usá-los para acessar destaques e recursos extras.',
  $md$Dentro da Freelandoo existe uma moeda interna chamada Polén. Ela funciona como um crédito que dá acesso a recursos da plataforma — e entender como ela funciona ajuda a aproveitar melhor.

## O que são os Poléns

Poléns são créditos internos, não conversíveis em dinheiro e não transferíveis. Eles servem para **destravar recursos** dentro da própria plataforma, como destaques e impulsionamentos. Pense neles como fichas de um parque: valem lá dentro, para acessar as atrações.

## Para que servem

Os Poléns podem ser usados em recursos que aumentam sua visibilidade e alcance, como:

- Destacar um perfil ou uma publicação
- Impulsionar conteúdo para mais pessoas
- Acessar funcionalidades extras

Em vez de pagar avulso a cada uso, você gerencia um saldo e gasta conforme a estratégia.

## Como administrar seu saldo

- **Use com intenção**: destaque quando há algo a ganhar (uma promoção, um período de alta procura), não por impulso.
- **Acompanhe o histórico**: ver onde seus Poléns foram gastos ajuda a entender o que trouxe retorno.
- **Planeje picos**: guarde saldo para momentos de maior concorrência, quando o destaque faz mais diferença.

## Transparência total

Todo movimento de Poléns fica registrado: o que entrou, o que saiu e em quê. Esse histórico é seu — use-o para tomar decisões melhores sobre onde investir sua atenção e seus créditos.

Os Poléns são uma ferramenta. Como toda ferramenta, rendem mais quando usados com estratégia: no momento certo, no recurso certo, com um objetivo claro em mente.$md$,
  NOW() - INTERVAL '8 days'
),
(
  'primeiros-7-dias-na-freelandoo-checklist-para-comecar',
  'Primeiros 7 dias na Freelandoo: o checklist para começar a vender',
  $ex$Acabou de chegar? Siga este roteiro de uma semana para sair do zero e deixar tudo pronto para receber clientes.$ex$,
  'Primeiros passos',
  ARRAY['onboarding','checklist','primeiros passos'],
  'published', 6,
  'Primeiros 7 dias na Freelandoo: checklist para começar | Freelandoo',
  'Um roteiro de 7 dias para configurar seu perfil, portfólio, serviços e conteúdo e começar a receber clientes na Freelandoo.',
  $md$Começar em uma plataforma nova pode parecer muita coisa de uma vez. Para facilitar, aqui vai um roteiro de uma semana: um passo por dia, sem pressa, até você estar pronto para receber clientes.

## Dia 1 — Monte a base do perfil

Coloque uma boa foto, escreva uma descrição que diga o que você resolve e crie seu primeiro subperfil com a profissão certa. É o alicerce de tudo.

## Dia 2 — Preencha o portfólio

Adicione de 3 a 5 dos seus melhores trabalhos. Se ainda não tem clientes, use projetos pessoais. Capriche na primeira imagem — ela é a que mais decide.

## Dia 3 — Cadastre seus serviços e preços

Liste o que você oferece, com descrição clara e preço definido. Lembre-se de pensar no valor que você quer receber líquido. Se você atende com hora marcada, configure sua agenda.

## Dia 4 — Grave seu primeiro vídeo

Um Story ou Bee simples já basta: apresente-se ou mostre um trabalho. Vídeo aproxima e gera confiança mais rápido que qualquer texto.

## Dia 5 — Explore e siga

Navegue pelo seu enxame, veja como colegas se apresentam, siga perfis interessantes e participe da comunidade. Você aprende muito observando quem já está rodando.

## Dia 6 — Ative a divulgação

Compartilhe seu perfil nas suas redes e com sua rede de contatos. Se houver programa de afiliados ou cupom, comece a divulgar de forma honesta. Os primeiros clientes muitas vezes vêm de quem já te conhece.

## Dia 7 — Revise e ajuste

Olhe seu perfil com olhos de cliente. Está claro o que você faz? O portfólio convence? O contato está fácil? Ajuste o que precisar e mantenha a constância nas semanas seguintes.

## O segredo não é o dia 7 — é o dia 30

Configurar é o começo. O que traz resultado é manter o ritmo: postar, responder rápido, atualizar o portfólio e cuidar de cada cliente. Faça esse checklist, e depois é só seguir aparecendo.

Bem-vindo. Agora é colocar a mão na massa.$md$,
  NOW() - INTERVAL '4 days'
)
ON CONFLICT (slug) DO NOTHING;
