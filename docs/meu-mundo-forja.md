# Meu Mundo — catálogo e forja (forge-v1)

Estado canônico: **63 IDs de Gear**, além dos **30 consumíveis de Life** já existentes: 93 nesses dois catálogos. Skins completas, veículos e casas pertencem a outros catálogos.

Os 24 IDs anteriores são preservados. A lista editorial de 31 foi normalizada: aprendiz substitui aspirante; latão substitui sabre/bronze e cajado de cobre; nucleo_eter é a matéria-prima antes chamada cristal; amuleto_aurion e pintura_arma_eter mantêm seus IDs atuais. Somam-se os dez nomes extras e os três itens antigos fora dessa lista (couraca_rebitada, relogio_bolso, cristal_morkhan): 44 itens. Mais 19 componentes universais = 63. Nenhum item adicional de pity foi criado.

## Modelo e compatibilidade

- 8 armas (2 iniciais e 6 forjáveis), 2 proteções, 8 acessórios, 17 materiais básicos/técnicos, 3 projetos, 3 recordações investigáveis, 3 cosméticos e 19 componentes.
- Slots preservados: weapon, armor, acc1, acc2. Botas, óculos, luvas e bracelete são acessórios; não há novos encaixes de armadura ou GLBs presumidos.
- Componentes não têm grau nem refinamento próprio. A peça pronta é reutilizável entre graus; seis peças básicas são compartilhadas por espada/cajado. Cada fabricação entrega exatamente uma unidade. A montagem consome uma unidade de cada tipo exigido.
- Nenhum ID, posse, quantidade ou nível anterior é apagado. Armas de latão dos donos atuais continuam válidas; a compra direta por 600 moedas sai do catálogo para não contornar a nova forja.
- Catálogo não significa asset 3D pronto: há visuais iniciais de espada/cajado já existentes; as novas peças usam imagem/placeholder. Nenhuma outra malha é declarada pronta por este módulo.

## Catálogo completo

| ID estável | Nome | Categoria | Função | Fonte implementada |
|---|---|---|---|---|
| `espada_aprendiz` | Espada de aprendiz | weapon | Arma inicial do vampiro, entregue pelo prólogo. Não altera classe, sexo ou aparência do personagem. | Prólogo: arma inicial gratuita da classe. |
| `cajado_aprendiz` | Cajado de aprendiz | weapon | Arma inicial da raposa, entregue pelo prólogo. Não altera classe, sexo ou aparência do personagem. | Prólogo: arma inicial gratuita da classe. |
| `espada_latao` | Espada de latão | weapon | Espada de progressão montada com dez peças diferentes, uma unidade de cada. | Ferreiro: montar Espada de latão (300 moedas e ingredientes da receita). |
| `cajado_latao` | Cajado de latão | weapon | Cajado de progressão montado com dez peças diferentes, uma unidade de cada. | Ferreiro: montar Cajado de latão (300 moedas e ingredientes da receita). |
| `espada_eter` | Espada de éter | weapon | Espada intermediária: doze peças diferentes e projeto de éter aprendido. | Ferreiro: montar Espada de éter (1000 moedas e ingredientes da receita). |
| `cajado_eter` | Cajado de éter | weapon | Cajado intermediário: doze peças diferentes e projeto de éter aprendido. | Ferreiro: montar Cajado de éter (1000 moedas e ingredientes da receita). |
| `espada_solar` | Lâmina solar | weapon | Lâmina avançada: quinze peças diferentes, projeto de éter e nível de aventura oito. | Ferreiro: montar Lâmina solar (3000 moedas e ingredientes da receita). |
| `cajado_solar` | Cajado solar | weapon | Cajado avançado: quinze peças diferentes, projeto de éter e nível de aventura oito. | Ferreiro: montar Cajado solar (3000 moedas e ingredientes da receita). |
| `colete_couro` | Colete de couro | armor | Proteção de couro com defesa adicional; ocupa o slot de proteção. | Loja de equipamentos: 250 moedas. / Ferreiro: produzir Colete de couro (120 moedas e ingredientes da receita). |
| `couraca_rebitada` | Couraça rebitada | armor | Proteção reforçada com rebites; pode ser refinada e preserva seu aprimoramento anterior. | Loja de equipamentos: 700 moedas. / Ferreiro: produzir Couraça rebitada (150 moedas e ingredientes da receita). |
| `relogio_bolso` | Relógio de bolso | accessory | Acessório que amplia o aviso dos ataques inimigos nas lutas de aventura. | Loja de equipamentos: 300 moedas. |
| `luvas_precisao` | Luvas de precisão | accessory | Acessório que melhora a eficiência de fôlego nas lutas de aventura. | Loja de equipamentos: 420 moedas. / Ferreiro: produzir Luvas de precisão (90 moedas e ingredientes da receita). |
| `amuleto_aurion` | Amuleto de Aurion | accessory | Acessório de Aurion que melhora o poder especial, dentro do teto de equipamento. | Ferreiro: produzir Amuleto de Aurion (1000 moedas e ingredientes da receita). |
| `botas_explorador` | Botas do explorador | accessory | Acessório que combina eficiência de fôlego e defesa. Não aumenta a velocidade de corrida. | Loja de equipamentos: 650 moedas. |
| `oculos_engenheiro` | Óculos do engenheiro | accessory | Acessório de precisão que amplia o aviso de ataques; não fornece mira automática. | Loja de equipamentos: 700 moedas. |
| `bracelete_isolante` | Bracelete isolante | accessory | Acessório defensivo. A proteção se soma aos outros equipamentos dentro do teto. | Loja de equipamentos: 1000 moedas. |
| `medalhao_lunar` | Medalhão lunar | accessory | Acessório que combina eficiência de fôlego e poder especial nas lutas de aventura. | Ferreiro: produzir Medalhão lunar (550 moedas e ingredientes da receita). |
| `nucleo_equilibrio` | Núcleo de equilíbrio | accessory | Acessório que combina defesa e aviso de ataques. Não é a matéria-prima Núcleo de éter. | Ferreiro: produzir Núcleo de equilíbrio (550 moedas e ingredientes da receita). |
| `fragmento_lamina` | Fragmento de lâmina | material | Metal recuperado das lutas: matéria-prima da forja e custo base do refinamento de armas. | Lâminas e monstros: material básico garantido de uma atividade validada. |
| `nucleo_eter` | Núcleo de éter | material | Matéria-prima de energia para peças, acessórios e refinamentos. Pode ser condensada sem sorteio. | Vitórias da família forja: chance de 35%; há condensação garantida no ferreiro. / Ferreiro: produzir Núcleo de éter (80 moedas e ingredientes da receita). |
| `selo_forja` | Selo de forja | material | Certificação usada na montagem solar, refinamentos altos e proteção opcional. Também pode ser fabricada sem sorteio. | Vitórias da família forja: chance de 6%; há certificação garantida no ferreiro. / Ferreiro: produzir Selo de forja (650 moedas e ingredientes da receita). |
| `couro_reforcado` | Couro reforçado | material | Matéria-prima de proteção, empunhaduras e fibras; custo base do refinamento de armaduras. | Boxe: material básico garantido de uma atividade validada. |
| `rebite` | Rebites | material | Fixador de latão usado em estruturas, travas, proteção e engrenagens. | Vitórias do Boxe: chance de 35%; também pode ser produzido no ferreiro. / Ferreiro: produzir Rebites (15 moedas e ingredientes da receita). |
| `pigmento_eter` | Pigmento de éter | material | Pigmento condutor usado em focos, núcleos, circuitos e cosméticos de éter. | Paint: material básico garantido de uma atividade validada. / Ferreiro: produzir Pigmento de éter (80 moedas e ingredientes da receita). |
| `mola_precisao` | Mola de precisão | material | Mola mecânica para travas e estabilizadores; também integra luvas e medalhões de forja. | Gincana: material básico garantido de uma atividade validada. / Ferreiro: produzir Mola de precisão (30 moedas e ingredientes da receita). |
| `injetor_vapor` | Injetor de vapor | material | Componente bruto de propulsão usado em células de energia e injetores de arma. | Jetpack: material básico garantido de uma atividade validada. / Ferreiro: produzir Injetor de vapor (40 moedas e ingredientes da receita). |
| `capacitor` | Capacitor | material | Componente de levitação usado em células, estabilizadores e reguladores. | Antigravidade: material básico garantido de uma atividade validada. / Ferreiro: produzir Capacitor (65 moedas e ingredientes da receita). |
| `rolamento` | Rolamento | material | Componente de bronze usado em buchas e no acessório Núcleo de equilíbrio. | Rolê Noturno: material básico garantido de uma atividade validada. / Ferreiro: produzir Rolamento (30 moedas e ingredientes da receita). |
| `sucata_bronze` | Sucata de bronze | material | Metal básico recuperado, usado para fabricar fixadores, estruturas e ligas. | Ferreiro: produzir Sucata de bronze (12 moedas e ingredientes da receita). |
| `engrenagem_precisao` | Engrenagem de precisão | material | Engrenagem usinada para travas, pomos, anéis, selos e reguladores solares. | Ferreiro: produzir Engrenagem de precisão (35 moedas e ingredientes da receita). |
| `liga_leve` | Liga leve | material | Liga estrutural usada em lâminas, hastes, carcaças e blindagens de núcleo. | Ferreiro: produzir Liga leve (60 moedas e ingredientes da receita). |
| `insignia_ringue` | Insígnia do ringue | material | Peça de forja inspirada no ringue: integra guardas, anéis e amuletos. Não é uma classificação competitiva. | Ferreiro: produzir Insígnia do ringue (90 moedas e ingredientes da receita). |
| `fibra_resistente` | Fibra resistente | material | Fibra produzida a partir de couro, usada em empunhaduras, hastes e circuitos. | Ferreiro: produzir Fibra resistente (25 moedas e ingredientes da receita). |
| `medalhao_travessia` | Medalhão da travessia | material | Medalhão de forja usado em pomos, coroas e acessórios. É distinto do Medalhão lunar equipado. | Ferreiro: produzir Medalhão da travessia (110 moedas e ingredientes da receita). |
| `celula_energia` | Célula de energia de éter | material | Célula de energia de éter montada com injetores e capacitores; alimenta peças e rastros. | Ferreiro: produzir Célula de energia de éter (120 moedas e ingredientes da receita). |
| `receita_eter` | Receita: armas de éter | recipe | Projeto que, aprendido, habilita as quatro montagens de armas de éter e solares. | Ferreiro: produzir Receita: armas de éter (1000 moedas e ingredientes da receita). |
| `receita_latao` | Projeto: armas de latão | recipe | Projeto que, aprendido, habilita as duas montagens de armas de latão. Cada arma continua exclusiva de sua classe. | Ferreiro: produzir Projeto: armas de latão (400 moedas e ingredientes da receita). |
| `receita_colete` | Projeto: colete de couro | recipe | Projeto que, aprendido, habilita fabricar o colete de couro na forja. | Ferreiro: produzir Projeto: colete de couro (350 moedas e ingredientes da receita). |
| `cristal_morkhan` | Cristal rachado de Morkhan | quest | Recordação de Lúmen com uma inscrição sobre Morkhan; pode ser examinada na coleção. | Ferreiro: produzir Cristal rachado de Morkhan (600 moedas e ingredientes da receita). |
| `chave_subestacao` | Chave da subestação | quest | Recordação da subestação. Examine sua inscrição para registrar a descoberta na coleção. | Ferreiro: produzir Chave da subestação (180 moedas e ingredientes da receita). |
| `diario_sem_nome` | Diário do Sem-Nome | quest | Registro investigável sobre Aurion, os Sete e o Sem-Nome; integra a coleção de descobertas. | Ferreiro: produzir Diário do Sem-Nome (200 moedas e ingredientes da receita). |
| `pintura_arma_eter` | Pintura de arma: éter | cosmetic | Acabamento cosmético de éter para a arma, sem alterar atributos, alcance ou dano. | Ferreiro: produzir Pintura de arma: éter (450 moedas e ingredientes da receita). |
| `rastro_eter` | Rastro de éter | cosmetic | Rastro cosmético de éter para golpes, sem alterar a janela de acerto ou o alcance. | Ferreiro: produzir Rastro de éter (600 moedas e ingredientes da receita). |
| `emote_saudacao` | Emote: saudação de Lúmen | cosmetic | Desbloqueia a saudação social de Lúmen, sem bônus de combate. | Ferreiro: produzir Emote: saudação de Lúmen (250 moedas e ingredientes da receita). |
| `peca_empunhadura` | Empunhadura revestida | material / componente | Pegada isolada e revestida, comum a espadas e cajados. | Ferreiro: fabricar uma peça de Empunhadura revestida (80 moedas e ingredientes da receita). |
| `peca_condutor` | Condutor de éter | material / componente | Canal que conduz energia entre a arma e seu núcleo. | Ferreiro: fabricar uma peça de Condutor de éter (100 moedas e ingredientes da receita). |
| `peca_nucleo` | Núcleo condutor montado | material / componente | Núcleo de arma montado; diferente da matéria-prima Núcleo de éter. | Ferreiro: fabricar uma peça de Núcleo condutor montado (140 moedas e ingredientes da receita). |
| `peca_trava` | Trava de precisão | material / componente | Trava que mantém os componentes alinhados durante o golpe. | Ferreiro: fabricar uma peça de Trava de precisão (100 moedas e ingredientes da receita). |
| `peca_bucha` | Bucha de articulação | material / componente | Bucha ajustada para unir a estrutura à empunhadura. | Ferreiro: fabricar uma peça de Bucha de articulação (90 moedas e ingredientes da receita). |
| `peca_carcaca` | Carcaça rebitada | material / componente | Estrutura externa de uma arma, sem bônus quando solta. | Ferreiro: fabricar uma peça de Carcaça rebitada (130 moedas e ingredientes da receita). |
| `peca_lamina` | Corpo da lâmina | material / componente | Corpo metálico exclusivo da montagem de espadas. | Ferreiro: fabricar uma peça de Corpo da lâmina (200 moedas e ingredientes da receita). |
| `peca_fio` | Fio temperado | material / componente | Fio tratado que completa o corpo de uma espada. | Ferreiro: fabricar uma peça de Fio temperado (140 moedas e ingredientes da receita). |
| `peca_guarda` | Guarda do duelista | material / componente | Guarda de espada com a insígnia incrustada. | Ferreiro: fabricar uma peça de Guarda do duelista (160 moedas e ingredientes da receita). |
| `peca_pomo` | Pomo de contrapeso | material / componente | Contrapeso de espada com o medalhão da travessia. | Ferreiro: fabricar uma peça de Pomo de contrapeso (180 moedas e ingredientes da receita). |
| `peca_haste` | Haste segmentada | material / componente | Estrutura longa exclusiva da montagem de cajados. | Ferreiro: fabricar uma peça de Haste segmentada (190 moedas e ingredientes da receita). |
| `peca_coroa` | Coroa do cajado | material / componente | Suporte superior do cajado, com o medalhão incrustado. | Ferreiro: fabricar uma peça de Coroa do cajado (170 moedas e ingredientes da receita). |
| `peca_foco` | Foco prismático | material / componente | Foco que concentra a energia do cajado. | Ferreiro: fabricar uma peça de Foco prismático (210 moedas e ingredientes da receita). |
| `peca_anel` | Anel de fixação | material / componente | Anel de cajado com a insígnia gravada. | Ferreiro: fabricar uma peça de Anel de fixação (170 moedas e ingredientes da receita). |
| `peca_estabilizador` | Estabilizador de éter | material / componente | Peça adicional exigida pelas armas de éter e solares. | Ferreiro: fabricar uma peça de Estabilizador de éter (320 moedas e ingredientes da receita). |
| `peca_injetor` | Injetor de arma montado | material / componente | Injetor calibrado para a arma; usa injetores de vapor como matéria-prima. | Ferreiro: fabricar uma peça de Injetor de arma montado (360 moedas e ingredientes da receita). |
| `peca_regulador` | Regulador solar | material / componente | Regulador certificado, exclusivo da montagem solar. | Ferreiro: fabricar uma peça de Regulador solar (600 moedas e ingredientes da receita). |
| `peca_blindagem` | Blindagem do núcleo | material / componente | Isolamento reforçado para o núcleo de uma arma solar. | Ferreiro: fabricar uma peça de Blindagem do núcleo (700 moedas e ingredientes da receita). |
| `peca_retorno` | Circuito de retorno | material / componente | Circuito que fecha a montagem de uma arma solar. | Ferreiro: fabricar uma peça de Circuito de retorno (800 moedas e ingredientes da receita). |

## Receitas quantitativas

Todos os resultados são **uma unidade**. Moedas são pagas a cada fabricação, além dos ingredientes. Projeto aprendido habilita a receita; a posse legada do projeto continua compatível no serviço. Montagens usam componentes prontos e nunca pulam a fabricação individual das peças.

| Receita | Resultado | Nível | Moedas | Ingredientes | Projeto |
|---|---|---:|---:|---|---|
| `fabricar_peca_empunhadura` | `peca_empunhadura` | 2 | 80 | 4 × `couro_reforcado`, 3 × `fibra_resistente`, 2 × `rebite` | — |
| `fabricar_peca_condutor` | `peca_condutor` | 2 | 100 | 3 × `liga_leve`, 1 × `pigmento_eter`, 2 × `fragmento_lamina` | — |
| `fabricar_peca_nucleo` | `peca_nucleo` | 2 | 140 | 2 × `nucleo_eter`, 1 × `celula_energia`, 3 × `fragmento_lamina` | — |
| `fabricar_peca_trava` | `peca_trava` | 2 | 100 | 2 × `engrenagem_precisao`, 2 × `mola_precisao`, 4 × `rebite` | — |
| `fabricar_peca_bucha` | `peca_bucha` | 2 | 90 | 2 × `rolamento`, 4 × `sucata_bronze`, 2 × `rebite` | — |
| `fabricar_peca_carcaca` | `peca_carcaca` | 2 | 130 | 4 × `liga_leve`, 6 × `sucata_bronze`, 4 × `rebite` | — |
| `fabricar_peca_lamina` | `peca_lamina` | 2 | 200 | 12 × `fragmento_lamina`, 4 × `liga_leve` | — |
| `fabricar_peca_fio` | `peca_fio` | 2 | 140 | 8 × `fragmento_lamina`, 2 × `pigmento_eter` | — |
| `fabricar_peca_guarda` | `peca_guarda` | 2 | 160 | 6 × `sucata_bronze`, 2 × `couro_reforcado`, 1 × `insignia_ringue` | — |
| `fabricar_peca_pomo` | `peca_pomo` | 2 | 180 | 4 × `sucata_bronze`, 2 × `engrenagem_precisao`, 1 × `medalhao_travessia` | — |
| `fabricar_peca_haste` | `peca_haste` | 2 | 190 | 6 × `liga_leve`, 4 × `fibra_resistente` | — |
| `fabricar_peca_coroa` | `peca_coroa` | 2 | 170 | 6 × `sucata_bronze`, 2 × `pigmento_eter`, 1 × `medalhao_travessia` | — |
| `fabricar_peca_foco` | `peca_foco` | 2 | 210 | 3 × `nucleo_eter`, 3 × `pigmento_eter` | — |
| `fabricar_peca_anel` | `peca_anel` | 2 | 170 | 4 × `sucata_bronze`, 2 × `engrenagem_precisao`, 1 × `insignia_ringue` | — |
| `fabricar_peca_estabilizador` | `peca_estabilizador` | 3 | 320 | 2 × `capacitor`, 3 × `mola_precisao`, 4 × `liga_leve` | — |
| `fabricar_peca_injetor` | `peca_injetor` | 3 | 360 | 3 × `injetor_vapor`, 2 × `celula_energia`, 2 × `pigmento_eter` | — |
| `fabricar_peca_regulador` | `peca_regulador` | 8 | 600 | 1 × `selo_forja`, 4 × `engrenagem_precisao`, 3 × `capacitor` | — |
| `fabricar_peca_blindagem` | `peca_blindagem` | 8 | 700 | 4 × `nucleo_eter`, 8 × `liga_leve`, 4 × `couro_reforcado` | — |
| `fabricar_peca_retorno` | `peca_retorno` | 8 | 800 | 3 × `celula_energia`, 6 × `fibra_resistente`, 4 × `pigmento_eter` | — |
| `forjar_espada_latao` | `espada_latao` | 2 | 300 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_lamina`, 1 × `peca_fio`, 1 × `peca_guarda`, 1 × `peca_pomo` | `receita_latao` |
| `forjar_cajado_latao` | `cajado_latao` | 2 | 300 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_haste`, 1 × `peca_coroa`, 1 × `peca_foco`, 1 × `peca_anel` | `receita_latao` |
| `forjar_espada_eter` | `espada_eter` | 3 | 1000 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_lamina`, 1 × `peca_fio`, 1 × `peca_guarda`, 1 × `peca_pomo`, 1 × `peca_estabilizador`, 1 × `peca_injetor` | `receita_eter` |
| `forjar_cajado_eter` | `cajado_eter` | 3 | 1000 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_haste`, 1 × `peca_coroa`, 1 × `peca_foco`, 1 × `peca_anel`, 1 × `peca_estabilizador`, 1 × `peca_injetor` | `receita_eter` |
| `forjar_espada_solar` | `espada_solar` | 8 | 3000 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_lamina`, 1 × `peca_fio`, 1 × `peca_guarda`, 1 × `peca_pomo`, 1 × `peca_estabilizador`, 1 × `peca_injetor`, 1 × `peca_regulador`, 1 × `peca_blindagem`, 1 × `peca_retorno` | `receita_eter` |
| `forjar_cajado_solar` | `cajado_solar` | 8 | 3000 | 1 × `peca_empunhadura`, 1 × `peca_condutor`, 1 × `peca_nucleo`, 1 × `peca_trava`, 1 × `peca_bucha`, 1 × `peca_carcaca`, 1 × `peca_haste`, 1 × `peca_coroa`, 1 × `peca_foco`, 1 × `peca_anel`, 1 × `peca_estabilizador`, 1 × `peca_injetor`, 1 × `peca_regulador`, 1 × `peca_blindagem`, 1 × `peca_retorno` | `receita_eter` |
| `recuperar_bronze` | `sucata_bronze` | 2 | 12 | 2 × `fragmento_lamina` | — |
| `produzir_rebite` | `rebite` | 2 | 15 | 1 × `sucata_bronze` | — |
| `tecer_fibra` | `fibra_resistente` | 2 | 25 | 2 × `couro_reforcado` | — |
| `usinar_engrenagem` | `engrenagem_precisao` | 2 | 35 | 3 × `sucata_bronze`, 2 × `rebite` | — |
| `fundir_liga` | `liga_leve` | 2 | 60 | 4 × `sucata_bronze`, 2 × `fragmento_lamina` | — |
| `destilar_pigmento` | `pigmento_eter` | 2 | 80 | 6 × `fragmento_lamina`, 2 × `sucata_bronze` | — |
| `condensar_nucleo` | `nucleo_eter` | 2 | 80 | 8 × `fragmento_lamina`, 1 × `pigmento_eter` | — |
| `certificar_selo` | `selo_forja` | 3 | 650 | 20 × `fragmento_lamina`, 4 × `nucleo_eter`, 2 × `engrenagem_precisao` | — |
| `cunhar_insignia` | `insignia_ringue` | 2 | 90 | 12 × `couro_reforcado`, 8 × `rebite` | — |
| `cunhar_medalhao` | `medalhao_travessia` | 2 | 110 | 10 × `mola_precisao`, 6 × `fibra_resistente` | — |
| `montar_celula` | `celula_energia` | 2 | 120 | 4 × `injetor_vapor`, 2 × `capacitor` | — |
| `montar_capacitor` | `capacitor` | 2 | 65 | 4 × `sucata_bronze`, 1 × `nucleo_eter` | — |
| `montar_injetor` | `injetor_vapor` | 2 | 40 | 4 × `sucata_bronze`, 4 × `rebite` | — |
| `usinar_rolamento` | `rolamento` | 2 | 30 | 3 × `sucata_bronze`, 1 × `mola_precisao` | — |
| `temperar_mola` | `mola_precisao` | 2 | 30 | 3 × `sucata_bronze`, 1 × `rebite` | — |
| `copiar_receita_latao` | `receita_latao` | 2 | 400 | 12 × `fragmento_lamina`, 12 × `sucata_bronze` | — |
| `copiar_receita_eter` | `receita_eter` | 3 | 1000 | 6 × `nucleo_eter`, 6 × `pigmento_eter`, 2 × `selo_forja` | — |
| `copiar_receita_colete` | `receita_colete` | 2 | 350 | 12 × `couro_reforcado`, 16 × `rebite` | — |
| `forjar_couraca` | `couraca_rebitada` | 3 | 150 | 6 × `couro_reforcado`, 8 × `rebite` | — |
| `forjar_luvas` | `luvas_precisao` | 2 | 90 | 3 × `couro_reforcado`, 4 × `mola_precisao` | — |
| `forjar_colete` | `colete_couro` | 2 | 120 | 6 × `couro_reforcado`, 3 × `fibra_resistente`, 6 × `rebite` | `receita_colete` |
| `forjar_medalhao_lunar` | `medalhao_lunar` | 3 | 550 | 2 × `medalhao_travessia`, 4 × `nucleo_eter`, 4 × `pigmento_eter` | — |
| `forjar_nucleo_equilibrio` | `nucleo_equilibrio` | 3 | 550 | 4 × `capacitor`, 4 × `nucleo_eter`, 4 × `rolamento` | — |
| `forjar_amuleto_aurion` | `amuleto_aurion` | 3 | 1000 | 2 × `selo_forja`, 6 × `nucleo_eter`, 2 × `insignia_ringue` | — |
| `reunir_vestigios_morkhan` | `cristal_morkhan` | 3 | 600 | 6 × `nucleo_eter`, 6 × `pigmento_eter`, 1 × `selo_forja` | — |
| `reconstituir_diario` | `diario_sem_nome` | 3 | 200 | 12 × `fragmento_lamina`, 4 × `pigmento_eter` | — |
| `reconstituir_chave` | `chave_subestacao` | 3 | 180 | 8 × `sucata_bronze`, 2 × `engrenagem_precisao`, 1 × `nucleo_eter` | — |
| `produzir_pintura_eter` | `pintura_arma_eter` | 3 | 450 | 8 × `pigmento_eter`, 2 × `nucleo_eter` | — |
| `produzir_rastro_eter` | `rastro_eter` | 3 | 600 | 10 × `pigmento_eter`, 3 × `celula_energia` | — |
| `registrar_saudacao` | `emote_saudacao` | 2 | 250 | 1 × `insignia_ringue`, 1 × `medalhao_travessia` | — |

## Montagens e piso do custo

O valor soma as moedas de fabricar cada peça uma vez mais a montagem final. **Não inclui** produzir matérias-primas intermediárias, aprender projetos ou refinar. Portanto é um piso, não o preço total.

| Arma | Tipos diferentes | Peças + montagem |
|---|---:|---:|
| Espada de latão | 10 | 1620 moedas |
| Cajado de latão | 10 | 1680 moedas |
| Espada de éter | 12 | 3000 moedas |
| Cajado de éter | 12 | 3060 moedas |
| Lâmina solar | 15 | 7100 moedas |
| Cajado solar | 15 | 7160 moedas |

## Refinamento com proposta e sorteio

- Forge.quote(item, level, { failures, protected }) calcula custo total, chances, piso e pity; Forge.roll(quote, R) recebe sorteio exclusivamente do servidor.
- Gerar proposta cobra o custo; aceitar aplica o nível candidato, recusar mantém o nível atual sem devolver moedas ou materiais. O cliente nunca envia chances ou o candidato.
- Máximo +10; pisos +0/+3/+6. No próprio piso, a chance de perda vira chance de manter. Três resultados sem subida garantem subida na quarta tentativa.
- Sorteio acima do nível atual zera o contador de falhas mesmo quando recusado. Resultado igual/menor avança o contador mesmo quando recusado.
- Proteção opcional custa 1/2/3 Selos de forja por faixa. A sobretaxa já está em quote.cost; no piso ou em pity garantido não há risco de queda nem cobrança de proteção.
- A proposta dura quinze minutos. Serviço/Storage resolvem expiração, concorrência, recibos e idempotência. Este módulo não altera saldos nem sorteia no navegador.

| Nível atual | Moedas | Fragmentos (arma) ou couro (proteção) | Núcleos | Selos básicos | Subir/manter/cair antes de piso/proteção |
|---:|---:|---:|---:|---:|---|
| 0 | 120 | 2 | 0 | 0 | 75% / 20% / 5% |
| 1 | 220 | 3 | 0 | 0 | 75% / 20% / 5% |
| 2 | 380 | 4 | 0 | 0 | 75% / 20% / 5% |
| 3 | 600 | 6 | 1 | 0 | 55% / 30% / 15% |
| 4 | 900 | 8 | 2 | 0 | 55% / 30% / 15% |
| 5 | 1400 | 12 | 3 | 0 | 55% / 30% / 15% |
| 6 | 2100 | 16 | 4 | 1 | 35% / 40% / 25% |
| 7 | 3000 | 20 | 5 | 1 | 35% / 40% / 25% |
| 8 | 4200 | 26 | 6 | 2 | 35% / 40% / 25% |
| 9 | 5800 | 34 | 8 | 3 | 25% / 45% / 30% |

Bônus por nível preservados: +2% dano em armas e +1,5% defesa em proteções, agora até +10. Cada nível acima de +5 soma +0,4% fôlego, +0,4% aviso e +1% poder. Tetos somados: dano 35%, defesa 25%, fôlego 12%, aviso 12%, poder 18%. O espelho da simulação de luta deve usar os mesmos limites. Modos competitivos normalizados não recebem vantagens de conta.

## Fontes garantidas e usos

- Fragmentos, couro, pigmentos, molas, injetores, capacitores e rolamentos são materiais básicos garantidos das famílias de atividade validadas. Núcleos (35%) e selos (6%) também têm conversões determinísticas: nenhum bloqueio depende exclusivamente do drop raro.
- Conversões cobrem sucata, rebites, fibras, engrenagens, ligas, núcleos, selos, insígnias, medalhões e células. Toda matéria-prima tem consumidor real em receita ou refinamento.
- Projeto: learn_recipe. Pintura/rastro: apply_weapon_cosmetic. Emote: unlock_emote. Recordação: inspect_quest. /gear/use e os registros do serviço executam essas ações com recibo.
- Chave, diário e cristal são leitura/coleção nesta entrega: não abrem prédio, concluem missão ou concedem prova de vitória. Nenhuma chave se converte em loot genérico.
- Cosméticos não modificam atributos. O módulo declara efeitos; o frontend conecta pintura/rastro/emote compatível sem presumir GLB ou clipe novo.

## Contrato público e verificação

publicGear().items expõe description:string, source:string[], uses:string[], assemblyParts:string[], component:boolean, use/action, cosmeticEffect e lore. RECIPES mantém id/out/needs/coins/level/recipe e acrescenta kind/qty quando aplicável. Todos os resultados são uma unidade; montagens contêm 10/12/15 IDs distintos, cada quantidade 1.

Verificar: 63 IDs e 55 receitas únicos; 19 componentes e seis montagens; metadata sem vazio; todo ingrediente/saída/projeto existe; grafo alcançável a partir de drops básicos e loja; pisos/pity/proteção; preservação de posse/nível; sem compra direta das armas forjadas; fonte de selo garantida; serviço validando recibos/propostas.

Traduções: scripts/i18n-mm3d-61-gear-data.json no frontend, em pt-BR/en/es, com quatro chaves por item: gear_ID, gearDesc_ID, gearSource_ID e gearUses_ID. A tarefa principal integra os dicionários.

## Prédios e acesso no jogo

- Forja das Engrenagens e Arsenal de Lúmen ficam atrás da academia, na parte sul do centro. O corredor de acesso tem 3 metros; ruas, estacionamento e hospital mantêm suas posições.
- A Forja tem bancada de fabricação e bancada de refinamento; o Arsenal tem vendedor de equipamentos. As interações abrem as abas correspondentes do mesmo inventário.
- Os modelos externos são GLB próprios, com chaminé/manômetro na Forja e escudo/espadas no Arsenal. Interiores usam mobiliário de oficina e expositor de armas.
- Armas montadas mantêm a classe e a animação da arma base. Latão, éter e solar recebem guarnições e cores diferentes; refinamento e pintura/rastro aparecem nas lutas. Boxe continua de luvas.
- Catálogo, mochila e balcões usam cards em carrossel com espaço para imagem, raridade e guia de origem/uso.

## Banco, teste e implantação

Migration nova: 323_meu_mundo_refino.sql. Executada pelo prestart normal do backend; cria propostas e desbloqueios e amplia o refinamento para +10. Não modifica moedas, XP ou atributos já conquistados.

Validação automatizada:

- npm run test:unit
- TEST_DATABASE_URL apontando exclusivamente para PostgreSQL local e banco descartável mm_refine_test: node test/meu-mundo-refino.e2e.js, depois node test/meu-mundo-aventura.e2e.js. Esses testes recriam tabelas apenas nesse banco protegido por validação de host/nome.
- Frontend: npm run lint, npx tsc --noEmit e npm run build.

Verificação manual: entrar no centro, contornar a academia e entrar nos dois novos prédios. Na Forja, fabricar uma peça, conferir o contador 10/12/15 e montar a arma quando reunir todas. No refino, conferir custos/chances, pagar a tentativa e comparar os bônus antes de aceitar ou recusar. Fechar e reabrir recupera a proposta paga. No Arsenal, comprar uma proteção e equipar pela mochila.

Limites desta entrega: chave/diário/cristal são colecionáveis de leitura, sem nova missão externa; a saudação tem desbloqueio persistente, mas ainda não possui seletor social de animação no centro. Custos e probabilidades estão centralizados para ajustes após observar a economia real. Não se paga com Poléns ou dinheiro real.
