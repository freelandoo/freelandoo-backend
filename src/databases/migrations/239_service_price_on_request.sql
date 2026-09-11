-- 239_service_price_on_request.sql
--
-- SERVIÇO POR ORÇAMENTO — o preço deixa de ser obrigatório.
--
-- `tb_profile_service.price_amount` é INTEGER NOT NULL DEFAULT 0, e até aqui
-- todo serviço tinha um número. Isso não serve para quem vende visita técnica,
-- reforma ou instalação: o valor sai depois de ver o equipamento. Hoje esse
-- profissional só tem dois caminhos, e os dois mentem — cadastrar um preço
-- inventado, ou cadastrar zero, que a vitrine publica como "R$ 0,00".
--
-- ⚠️ POR QUE UMA COLUNA, E NÃO "preço zero = orçamento".
--
-- Zero já significa outra coisa: serviço GRÁTIS. Sobrecarregar o valor faria a
-- plataforma não conseguir distinguir os dois, e a diferença é visível para o
-- cliente (um card diz "Grátis", o outro diz "Sob orçamento"). Pior: o
-- `BookingService` recusa preço abaixo da taxa mínima, então hoje o serviço com
-- zero já é irreservável — mas com a mensagem errada ("valor inferior à taxa
-- mínima da plataforma"), que não explica nada a quem só queria pedir um
-- orçamento.
--
-- ⚠️ O PREÇO CONTINUA NOT NULL, e é de propósito. Afrouxá-lo para NULL
-- obrigaria as ~dezenas de leituras que somam, comparam e formatam
-- `price_amount` a aprender o caso nulo — e a que esquecesse faria conta com
-- `null`, que em JS vira zero em silêncio. Com a flag, o preço segue sendo um
-- inteiro válido (zero, ignorado) e quem decide o que mostrar é UM predicado.
--
-- Nasce FALSE: todo serviço que existe hoje tem preço e continua exatamente
-- como está. Idempotente.

ALTER TABLE public.tb_profile_service
  ADD COLUMN IF NOT EXISTS price_on_request BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.tb_profile_service.price_on_request IS
  'TRUE = "sob orçamento": o card público não mostra preço e o serviço não entra no agendamento pago. price_amount fica em 0 e é ignorado.';
