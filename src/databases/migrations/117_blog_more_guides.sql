-- =============================================================================
-- Migration 117: +9 guias práticos para o blog (atendimento, pacotes,
-- recorrência, descrição, presença local, profissões, indicação, ranking, funil)
-- =============================================================================
-- Categorias já existentes. Idempotente: ON CONFLICT (slug) DO NOTHING.
-- Bodies em dollar-quoting ($md$...$md$). O admin edita e adiciona capas inline.
-- =============================================================================

INSERT INTO public.blog_posts (slug, title, excerpt, category, tags, status, reading_minutes, seo_title, seo_description, body_md, published_at)
VALUES
(
  'cliente-chamou-no-whatsapp-e-agora',
  'O cliente te chamou no WhatsApp. E agora?',
  $ex$Receber a mensagem é só o começo — a venda ainda não aconteceu. Veja como conduzir o atendimento depois do clique sem perder a oportunidade.$ex$,
  'Vender serviços',
  ARRAY['whatsapp','atendimento','vendas'],
  'published', 6,
  'O cliente te chamou no WhatsApp. E agora? | Freelandoo',
  'Como transformar o contato no WhatsApp em conversa comercial: primeira resposta, perguntas certas e fechamento sem pressão.',
  $md$Receber uma mensagem de cliente é bom. Mas a venda ainda não aconteceu. Na Freelandoo, o cliente pode encontrar seu perfil, analisar seus serviços e chamar você diretamente pelo WhatsApp. Esse contato direto é uma vantagem, mas também exige clareza: quem demora, responde mal ou não conduz a conversa pode perder uma oportunidade quente.

## Por que a primeira resposta importa

Quando alguém chama, ele está com o problema na cabeça AGORA. Quanto mais rápida e clara a sua resposta, maior a chance de fechar. Demora e respostas vagas dão tempo para o cliente procurar outra pessoa — ou desistir.

## O erro de responder apenas "oi, tudo bem?"

"Oi, tudo bem?" devolve a bola para o cliente e não avança nada. Ele já te chamou: assuma a conversa. Cumprimente, identifique-se e mostre que entendeu o motivo do contato em uma única mensagem.

## Modelo de primeira resposta profissional

> "Oi, [nome]! Aqui é o [seu nome], [sua profissão]. Vi que você precisa de [serviço]. Consigo te ajudar, sim. Pra te passar o valor certinho, me conta rapidinho: é pra quando e onde seria?"

Curto, simpático e já puxando as informações que você precisa.

## Como perguntar sobre prazo, local, orçamento e necessidade

Faça poucas perguntas, mas as certas:

- **Necessidade:** o que exatamente o cliente precisa?
- **Prazo:** é pra quando?
- **Local:** onde será (se for presencial)?
- **Referência de orçamento:** ele tem um valor em mente ou quer uma proposta?

Pergunte de forma leve, uma ou duas por vez — interrogatório afasta.

## Como explicar o próximo passo sem pressionar

Depois de entender, conduza: "Com base no que você me falou, o ideal seria [X]. Posso te mandar uma proposta com valor e prazo?". Você guia sem empurrar.

## Como encerrar a conversa com CTA claro

Nunca deixe a conversa morrer no "vou ver e te falo". Feche com um próximo passo concreto: "Te mando a proposta ainda hoje, pode ser?" ou "Consigo encaixar na [data]. Quer que eu reserve?".

## Modelo pronto de atendimento

1. Cumprimente e se identifique.
2. Mostre que entendeu o pedido.
3. Faça 2–3 perguntas-chave.
4. Proponha o próximo passo.
5. Feche com um CTA com data.

Atendimento bom não é falar muito — é conduzir com clareza.

---

**Monte seu perfil na Freelandoo e deixe seu WhatsApp pronto para receber oportunidades.**$md$,
  NOW() - INTERVAL '1 day'
),
(
  'como-criar-pacotes-de-servico',
  'Como criar pacotes de serviço para vender mais fácil',
  $ex$O cliente pergunta o valor e recebe uma resposta solta? Organize suas ofertas em pacotes — básico, intermediário e completo — e facilite a decisão.$ex$,
  'Vender serviços',
  ARRAY['pacotes','servicos','oferta'],
  'published', 6,
  'Como criar pacotes de serviço para vender mais fácil | Freelandoo',
  'Aprenda a empacotar seus serviços em opções claras (básico, intermediário e completo) para vender com mais facilidade.',
  $md$Muitos profissionais sabem fazer o serviço, mas têm dificuldade para apresentar a oferta. O cliente entra em contato, pergunta o valor e recebe uma resposta solta. Isso gera insegurança. Uma forma mais clara de vender é organizar seus serviços em pacotes: básico, intermediário e completo. Na Freelandoo, o profissional pode cadastrar serviços com descrição, valor, duração e informações importantes — o que facilita transformar uma habilidade em uma oferta objetiva.

## O que é um pacote de serviço

É um conjunto fechado de entregas com um nome, um preço e um escopo claro. Em vez de negociar tudo do zero a cada cliente, você oferece opções prontas.

## Diferença entre serviço avulso e pacote

- **Avulso:** "quanto custa um post?" — preço solto, fácil de comparar só por valor.
- **Pacote:** "plano com 12 posts no mês + stories" — o cliente compra um resultado, não uma peça.

Pacote tira o foco do "preço por item" e coloca no valor entregue.

## Exemplo para social media

- **Básico:** 8 posts/mês.
- **Intermediário:** 12 posts + 8 stories.
- **Completo:** 16 posts + stories + 1 reels/semana + relatório.

## Exemplo para manicure

- **Básico:** mão simples.
- **Intermediário:** mão + pé.
- **Completo:** mão + pé + spa + nail art.

## Exemplo para pedreiro/pintor

- **Básico:** pintura de 1 cômodo (material à parte).
- **Intermediário:** 1 cômodo com massa corrida e acabamento.
- **Completo:** casa/área com preparo, massa, pintura e limpeza.

## Como nomear seus pacotes

Use nomes simples e diretos (Básico, Essencial, Completo) ou ligados ao resultado (Começo, Crescimento, Profissional). Evite nomes confusos que o cliente não entende.

## Como evitar pacotes confusos

- No máximo 3 opções (mais que isso paralisa a decisão).
- Deixe claro o que está incluso em cada um.
- Garanta uma diferença óbvia entre eles.

## Checklist para cadastrar na Freelandoo

- [ ] 3 pacotes com nomes claros
- [ ] Descrição do que está incluso em cada
- [ ] Valor e duração definidos
- [ ] Diferença evidente entre as opções

---

**Cadastre seus serviços em formato de pacote e facilite a decisão do cliente.**$md$,
  NOW() - INTERVAL '2 days'
),
(
  'como-vender-servicos-recorrentes',
  'Como vender serviços recorrentes e parar de viver só de trabalho avulso',
  $ex$Trabalho avulso ajuda o caixa; serviço recorrente traz estabilidade. Veja como transformar uma demanda pontual em relacionamento mensal.$ex$,
  'Monetização',
  ARRAY['recorrencia','mensalidade','estabilidade'],
  'published', 7,
  'Como vender serviços recorrentes | Freelandoo',
  'Pare de depender de vendas do zero: aprenda a oferecer planos mensais e construir clientes recorrentes.',
  $md$Trabalho avulso ajuda no caixa. Serviço recorrente ajuda na estabilidade. Para muitos profissionais, o problema não é falta de capacidade, mas depender sempre de uma nova venda do zero. A Freelandoo pode funcionar como uma vitrine para atrair o primeiro contato, mas o crescimento real acontece quando o profissional transforma uma demanda pontual em relacionamento contínuo.

## O que é serviço recorrente

É um trabalho contratado de forma contínua — semanal, quinzenal ou mensal — em vez de uma única vez. Em troca de previsibilidade para o cliente, você ganha previsibilidade de renda.

## Quais profissões podem trabalhar com mensalidade

Mais do que você imagina: social media, limpeza/diarista, manutenção predial, beleza (manutenção de unhas, barba, cabelo), pet (banho e tosa, passeios), aulas e acompanhamentos. Sempre que existe uma necessidade que se repete, cabe recorrência.

## Como oferecer recorrência sem parecer insistente

Não empurre: mostre o benefício. "Pra manter o resultado, o ideal é a gente fazer isso todo mês. Posso te montar um plano com um valor melhor que o avulso?". Você oferece conveniência, não pressão.

## Como montar um plano mensal

- Defina a frequência (ex.: 1x por semana).
- Defina o escopo do mês.
- Dê um pequeno benefício em relação ao avulso (preço ou prioridade).
- Combine forma e dia de pagamento.

## Como explicar o benefício para o cliente

Foque no que ele ganha: resultado mantido, prioridade na agenda, menos preocupação e, normalmente, um custo melhor do que contratar avulso toda vez.

## Como registrar os combinados

Deixe tudo por escrito: o que está incluso, a frequência, o valor e o que acontece se faltar ou remarcar. Registro evita atrito e dá segurança aos dois lados.

## Modelo de mensagem para oferecer plano mensal

> "[Nome], gostei do nosso trabalho! Pra manter o resultado, montei um plano mensal: [escopo], toda [frequência], por R$ [valor]/mês. Fica mais em conta que o avulso e você não precisa ficar remarcando. Quer começar esse mês?"

---

**Use sua vitrine na Freelandoo para conquistar o primeiro contato e construir clientes recorrentes.**$md$,
  NOW() - INTERVAL '3 days'
),
(
  'descricao-de-servico-que-vende',
  'O que colocar na descrição do serviço para o cliente entender rápido',
  $ex$Cada serviço é uma mini página de venda. Veja a fórmula simples para descrever o que você faz e tirar as dúvidas do cliente antes do contato.$ex$,
  'Vender serviços',
  ARRAY['descricao','servicos','clareza'],
  'published', 6,
  'Descrição de serviço que vende | Freelandoo',
  'Aprenda a escrever a descrição de cada serviço com uma fórmula simples: problema + entrega + prazo + observação.',
  $md$Uma descrição ruim faz o cliente ter dúvidas. Uma descrição boa antecipa perguntas, reduz atrito e aumenta a chance de contato. Na Freelandoo, o profissional pode cadastrar serviços com descrição, valor e duração. Isso significa que cada serviço precisa funcionar como uma pequena página de venda: simples, objetiva e confiável.

## A função da descrição do serviço

Ela existe para responder, antes da conversa, o que o cliente mais quer saber: o que é, o que está incluso, quanto tempo leva e o que esperar. Quanto menos dúvida sobrar, mais quente chega o contato.

## O que não escrever

- Textos genéricos do tipo "faço de tudo".
- Termos técnicos que o cliente não entende.
- Promessas exageradas e impossíveis de cumprir.

## Fórmula simples: problema + entrega + prazo + observação

1. **Problema** que você resolve.
2. **Entrega** (o que o cliente recebe).
3. **Prazo** ou duração.
4. **Observação** importante (o que está/ não está incluso).

## Como explicar o que está incluso

Liste de forma objetiva o que faz parte: materiais, número de revisões, etapas. O cliente precisa saber exatamente o que recebe pelo valor.

## Como explicar o que não está incluso

Tão importante quanto o que entra: deixe claro o que é à parte (material, deslocamento, horas extras). Isso evita mal-entendido e protege você.

## Como usar linguagem simples

Escreva como você falaria com o cliente, não como um manual. Frases curtas, sem jargão.

## Exemplos prontos

- **Diarista:** "Limpeza completa de apartamento de até 2 quartos. Inclui cozinha, banheiros, quartos e sala. Duração média de 4h. Produtos por conta do cliente."
- **Designer:** "Criação de logo para seu negócio. Inclui 2 propostas e 1 rodada de ajuste. Entrega em até 5 dias. Arquivos em PNG e PDF."

## Checklist antes de publicar

- [ ] Diz o problema que resolve
- [ ] Mostra o que está incluso
- [ ] Mostra o que NÃO está incluso
- [ ] Tem prazo/duração
- [ ] Linguagem simples

---

**Revise seus serviços cadastrados e deixe cada descrição mais clara para quem quer contratar.**$md$,
  NOW() - INTERVAL '4 days'
),
(
  'como-aparecer-melhor-na-sua-cidade',
  'Como aparecer melhor na sua cidade usando a Freelandoo',
  $ex$Para serviço local, aparecer na cidade certa vale mais que aparecer para muita gente aleatória. Veja como fortalecer sua presença local.$ex$,
  'Primeiros passos',
  ARRAY['local','cidade','busca'],
  'published', 6,
  'Como aparecer melhor na sua cidade | Freelandoo',
  'Estratégia local na Freelandoo: profissão, localização, bio com referência da região e avaliações para ser encontrado por perto.',
  $md$Nem todo profissional precisa atender o Brasil inteiro. Para diaristas, manicures, pedreiros, tosadores, professores, mecânicos e prestadores locais, aparecer na cidade certa pode valer mais do que aparecer para muita gente aleatória. Na Freelandoo, o cliente pode buscar por localização, enxame e profissão — o que torna a presença local um ativo importante.

## Por que cidade importa para serviço local

Quem precisa de um eletricista quer alguém que atenda o bairro dele, não a 600 km. Para serviço presencial, proximidade é praticamente o primeiro filtro de decisão.

## Como escolher profissão e localização com clareza

Preencha sua cidade corretamente e escolha a profissão que o cliente realmente digitaria. Isso conecta você às buscas certas e evita aparecer onde não faz sentido.

## Como escrever uma bio com referência local

Cite a região que você atende: "Atendo a Zona Leste de São Paulo e bairros próximos". Isso dá contexto e aumenta a confiança de quem é da área.

## Como usar fotos reais do seu trabalho na região

Fotos de trabalhos feitos na cidade criam identificação. O cliente pensa: "isso é aqui perto, essa pessoa atende gente como eu".

## Como facilitar o contato pelo WhatsApp

Deixe o contato fácil e responda rápido. Em serviço local, muitas vezes vence quem responde primeiro e marca antes.

## Como pedir avaliações de clientes locais

Avaliações de clientes da mesma região valem ouro — funcionam como o boca a boca do bairro, só que público. Peça sempre depois de um bom trabalho.

## Como se diferenciar em cidades competitivas

Mostre especialidade ("especialista em X"), capricho nas fotos, agilidade na resposta e prova social. Em cidade disputada, são os detalhes que separam você do concorrente.

## Checklist de presença local

- [ ] Cidade e profissão corretas
- [ ] Bio com referência da região
- [ ] Fotos reais de trabalhos locais
- [ ] WhatsApp ativo e resposta rápida
- [ ] Avaliações de clientes da área

---

**Atualize sua cidade, profissão e serviços para ser encontrado por quem está perto.**$md$,
  NOW() - INTERVAL '5 days'
),
(
  'profissoes-que-combinam-com-a-freelandoo',
  'Profissões que combinam com a Freelandoo e talvez você ainda não pensou',
  $ex$Freelancer não é só designer e editor de vídeo. Beleza, pets, construção, transporte, eventos, educação e mais — veja onde sua profissão se encaixa.$ex$,
  'Comunidade',
  ARRAY['profissoes','enxames','oportunidades'],
  'published', 6,
  'Profissões que combinam com a Freelandoo | Freelandoo',
  'Muito além do trabalho digital: profissões locais, criativas, técnicas e de cuidado que se beneficiam de uma vitrine profissional.',
  $md$Quando alguém pensa em freelancer, geralmente lembra de designer, editor de vídeo ou social media. Mas uma vitrine profissional pode funcionar para muito mais áreas: beleza, pets, construção, transporte, eventos, educação, saúde, tecnologia e serviços residenciais. A Freelandoo organiza profissionais em Enxames, incluindo áreas como Marketing, Tecnologia, Transporte, Artistas, Serviços Residenciais, Construção, Saúde, Beleza e Bem-estar, Veículos, Pets, Rural, Educação e Eventos.

## Freelancer não é só trabalho digital

A palavra "freelancer" virou sinônimo de internet, mas o conceito é mais amplo: é qualquer pessoa que vende seu serviço por conta própria. Isso inclui muita gente que trabalha com as mãos, presencialmente.

## Profissões locais que podem se beneficiar

Diaristas, pedreiros, eletricistas, encanadores, pintores, montadores de móveis, chaveiros. Todo serviço residencial vive de ser encontrado por quem está perto.

## Profissões criativas

Designers, editores, fotógrafos, ilustradores, social media, redatores, criadores de conteúdo. Uma vitrine com portfólio é praticamente obrigatória aqui.

## Profissões técnicas

Mecânicos, técnicos de informática, instaladores, soldadores, profissionais de manutenção. Quem precisa, precisa rápido — estar visível faz diferença.

## Profissões de cuidado e bem-estar

Manicures, barbeiros, esteticistas, massagistas, cuidadores, pet sitters, tosadores. São serviços de confiança e recorrência, que crescem muito com avaliações.

## Profissões para eventos

DJs, fotógrafos e filmmakers, buffet, decoradores, cerimonialistas, garçons. Eventos costumam reunir vários profissionais — ótimo terreno para clãs.

## Como escolher a melhor categoria

Pense como o cliente busca. Escolha o Enxame e a profissão que melhor descrevem o que você entrega — sem tentar caber em tudo ao mesmo tempo.

## Como transformar uma habilidade em serviço anunciado

Pegue o que você já faz, dê um nome, defina um preço e descreva o resultado. Pronto: virou um serviço que pode ser encontrado e contratado.

---

**Veja em qual Enxame sua profissão se encaixa e crie sua presença profissional.**$md$,
  NOW() - INTERVAL '6 days'
),
(
  'transformar-indicacao-em-perfil-profissional',
  'Como transformar uma indicação em perfil profissional',
  $ex$Você trabalha bem, mas depende só de indicação? Veja como um perfil organiza seu boca a boca e te faz parecer mais confiável.$ex$,
  'Primeiros passos',
  ARRAY['indicacao','perfil','boca a boca'],
  'published', 5,
  'Como transformar uma indicação em perfil profissional | Freelandoo',
  'Pare de mandar só o número: um perfil profissional reúne descrição, serviços, portfólio e contato e fortalece quem vive de indicação.',
  $md$Muita gente trabalha bem, mas ainda depende só de indicação. Isso funciona até certo ponto. O problema é que a indicação costuma chegar sem organização: a pessoa pergunta no grupo, alguém manda seu número, o cliente chama e você precisa explicar tudo do zero. Um perfil profissional resolve parte disso, porque reúne descrição, localização, profissão, serviços, portfólio e contato em um lugar só.

## Por que a indicação ainda é importante

Indicação é a forma mais antiga e poderosa de venda: vem com confiança embutida. O objetivo aqui não é substituí-la, e sim potencializá-la.

## O problema de depender só do WhatsApp

Quando tudo mora no seu número, cada novo cliente começa do zero: sem ver trabalhos, sem entender seus serviços, sem prova nenhuma. Você gasta energia explicando o que um perfil já explicaria sozinho.

## Como o perfil funciona como cartão profissional

Um perfil reúne quem você é, o que faz, exemplos, serviços e contato. É um cartão de visita que trabalha 24 horas — e que dá uma impressão muito mais profissional do que só um número solto.

## Como mandar seu perfil para clientes antigos

Avise sua base: "Agora tenho um perfil com meus trabalhos e serviços, dá uma olhada: [link]". Reaquece contatos e ainda mostra que você evoluiu.

## Como pedir para clientes indicarem com link

Em vez de "passa meu número", peça: "se conhecer alguém, manda meu perfil". O link carrega contexto e prova — converte melhor que um número sem rosto.

## Como usar o perfil para parecer mais confiável

Portfólio preenchido, avaliações, descrição clara e foto profissional. Cada elemento reduz a desconfiança natural de quem ainda não te conhece.

## Como transformar boca a boca em vitrine

Toda indicação passa a cair em um lugar organizado, que vende por você. O boca a boca continua — só que agora com uma vitrine no fim do caminho.

---

**Pare de mandar só seu número. Envie seu perfil profissional.**$md$,
  NOW() - INTERVAL '7 days'
),
(
  'como-usar-ranking-como-prova-de-atividade',
  'Como usar o ranking como prova de atividade profissional',
  $ex$Cliente gosta de sinal de vida. Veja como usar a sua presença e o ranking como reputação — sem cair na armadilha de prometer resultado.$ex$,
  'Conteúdo e audiência',
  ARRAY['ranking','reputacao','presenca'],
  'published', 5,
  'Como usar o ranking como prova de atividade | Freelandoo',
  'Use o ranking e os sinais de presença como reputação na Freelandoo, com responsabilidade e sem manipular ou prometer venda.',
  $md$Cliente gosta de sinal de vida. Um perfil abandonado passa insegurança. Um perfil ativo transmite presença. A Freelandoo usa sinais de engajamento — como visitas ao perfil, likes no portfólio, avaliações e tempo online — para criar rankings e indicadores de atividade. Isso não garante contratação, mas ajuda o profissional a entender que presença digital também é comportamento.

## O que o ranking comunica para o cliente

Ele sinaliza que você está ativo e presente. Para quem vai contratar, atividade recente é um sinal de que você responde, trabalha e se importa com a sua vitrine.

## Diferença entre reputação e promessa de venda

Reputação é como você é percebido ao longo do tempo. Promessa de venda é garantir um resultado. O ranking ajuda na primeira — e **não** existe para garantir a segunda. Trate-o como reputação, não como bilhete premiado.

## Como a atividade melhora a percepção

Publicar trabalhos novos, responder, manter o perfil atualizado: tudo isso constrói a imagem de alguém em movimento. E gente em movimento transmite mais confiança que um perfil parado há meses.

## O que fazer para manter o perfil vivo

- Adicione trabalhos recentes ao portfólio.
- Responda mensagens com agilidade.
- Mantenha serviços e disponibilidade atualizados.
- Apareça com regularidade, sem sumir por semanas.

## Como usar avaliações com responsabilidade

Peça avaliações de quem realmente contratou e ficou satisfeito. Avaliação honesta vale muito; avaliação forçada ou falsa destrói a confiança quando o cliente percebe.

## Como NÃO tentar manipular o ranking

Nada de combinar likes, criar interações falsas ou inflar números. Além de antiético, desmancha quando exposto — e a credibilidade que você perde é difícil de recuperar.

## Ranking como termômetro, não como garantia

Veja o ranking como um termômetro da sua presença: útil para se orientar e melhorar, nunca como uma promessa de que o cliente vai aparecer. O trabalho ainda fecha pelo que você entrega.

---

**Atualize seu perfil, publique trabalhos reais e acompanhe sua presença na plataforma.**$md$,
  NOW() - INTERVAL '8 days'
),
(
  'mini-funil-de-vendas-na-freelandoo',
  'Como montar um mini funil de vendas dentro da Freelandoo',
  $ex$Vender serviço não acontece em um clique. Junte perfil, portfólio, WhatsApp e proposta em um fluxo simples — um funil — e organize sua conversão.$ex$,
  'Monetização',
  ARRAY['funil','vendas','conversao'],
  'published', 7,
  'Como montar um mini funil de vendas na Freelandoo | Freelandoo',
  'Transforme perfil, portfólio, WhatsApp e proposta em um funil simples de conversão para fechar mais serviços.',
  $md$Vender serviço não acontece em um único clique. O cliente precisa encontrar você, entender o que você faz, confiar minimamente no seu trabalho, chamar no WhatsApp e receber uma resposta clara. Esse caminho é um funil. Na Freelandoo, o profissional pode ter perfil público, portfólio, serviços cadastrados e botão de WhatsApp — formando uma base para organizar esse processo.

## O que é um funil simples para freelancer

Funil é só o caminho que o cliente percorre, do "nunca te vi" até "fechei com você". Pensar nesse caminho por etapas ajuda a descobrir onde você está perdendo gente.

## Etapa 1: ser encontrado

Sem visibilidade, não há funil. Profissão certa, cidade correta e perfil completo fazem você aparecer nas buscas de quem precisa.

## Etapa 2: gerar confiança

Quem te achou agora precisa confiar. Portfólio com trabalhos reais, descrição clara, foto profissional e avaliações fazem esse trabalho.

## Etapa 3: facilitar o contato

Confiou, precisa conseguir te chamar fácil. Deixe o WhatsApp visível e o caminho até ele curto.

## Etapa 4: responder com método

O contato chegou — agora conduza. Cumprimente, entenda a necessidade, faça as perguntas certas e proponha o próximo passo (veja o guia de atendimento no WhatsApp).

## Etapa 5: enviar proposta clara

Mande valor, escopo e prazo de forma objetiva. Proposta confusa trava a decisão; proposta clara acelera o "fechado".

## Etapa 6: manter relacionamento

Terminou um trabalho? Não suma. Peça avaliação, ofereça recorrência e mantenha contato. O cliente de hoje é a indicação (e a recompra) de amanhã.

## Exemplo prático de funil para profissional local

Uma diarista: aparece na busca da cidade → perfil com fotos de antes/depois e avaliações → cliente chama no WhatsApp → ela responde com perguntas-chave → manda pacote mensal → vira cliente recorrente.

## Checklist final

- [ ] Perfil completo e encontrável
- [ ] Portfólio + avaliações (confiança)
- [ ] WhatsApp fácil de achar
- [ ] Método de atendimento definido
- [ ] Proposta clara pronta
- [ ] Rotina de pós-venda

---

**Use seu perfil na Freelandoo como ponto de entrada para um processo de venda mais organizado.**$md$,
  NOW() - INTERVAL '9 days'
)
ON CONFLICT (slug) DO NOTHING;
