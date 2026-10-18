# Briefing — Cardápio Web Barão

> **Barão – Delivery de Pizza** · *"Peça agora e saboreie!"*
> Documento de briefing do projeto. Escrito para ser lido tanto pelo dono da pizzaria quanto pela equipe de desenvolvimento.
> Data: 18/10/2026 · Spec técnico: [`docs/superpowers/specs/2026-10-18-cardapio-barao-design.md`](superpowers/specs/2026-10-18-cardapio-barao-design.md)

---

## 1. Sobre o cliente

| | |
|---|---|
| **Nome** | Barão – Delivery de Pizza |
| **Slogan** | "Peça agora e saboreie!" |
| **Cidade** | Fortaleza/CE (fuso `America/Fortaleza`, UTC-3, sem horário de verão) |
| **Canal de pedidos** | WhatsApp (85) 99768-7641 |
| **Estilo** | Pizzaria tradicional, visual rústico, forno a lenha, mascote chef de bigode em uma lambreta vermelha |
| **Operação** | Delivery e retirada no balcão; pizza em tamanho único |

Hoje o Barão divulga um cardápio impresso/imagem e recebe pedidos por mensagens livres no WhatsApp.

## 2. Problema e objetivo

**Problema.** Pedidos por mensagem livre geram idas e vindas: o cliente não sabe os preços de cabeça, esquece o endereço ou a forma de pagamento, pergunta se pode fazer meio a meio, quanto custa a borda, se a loja está aberta. O atendente perde tempo digitando, conferindo e somando valores, e erros de soma viram prejuízo ou desconforto com o cliente. Também não existe histórico organizado do que foi vendido.

**Objetivo.** Criar um **cardápio web** em que o cliente monta o pedido no celular em poucos toques e, ao finalizar, o WhatsApp abre com uma **mensagem pronta, organizada e com o valor correto**, já com um código de pedido (ex.: `BR-0427`). Do lado da pizzaria, um **painel administrativo** permite manter o cardápio, os horários e consultar o histórico de pedidos com um resumo de vendas.

O WhatsApp continua sendo o canal de atendimento: o site não substitui a conversa, ele a **organiza**.

## 3. Público-alvo

- **Cliente final:** morador de Fortaleza, pedindo pelo **celular** (quase sempre), geralmente à noite, muitas vezes com pressa e com sinal de internet variável. Já está acostumado a pedir por WhatsApp. Não quer criar conta nem baixar aplicativo.
- **Equipe do Barão (admin):** dono e atendentes. Usam o painel no celular ou no computador do balcão para pausar um sabor que acabou, ajustar preço, abrir/fechar a loja manualmente e ver os pedidos do dia.

## 4. Proposta de valor

**Para o cliente**
- Cardápio bonito, rápido e sempre atualizado, com preço visível de tudo.
- Monta pizza inteira ou meio a meio e escolhe adicionais vendo o preço mudar na hora.
- Sem cadastro, sem senha, sem app: um link e pronto.
- Sabe na hora se a loja está aberta e quais itens estão esgotados.

**Para o Barão**
- Mensagens padronizadas, com código de pedido, itens, valores, endereço e forma de pagamento: menos digitação e menos erro.
- **Preço sempre correto**: o valor é recalculado no servidor a partir do cardápio cadastrado, nunca a partir do que o navegador envia.
- Controle do cardápio sem depender de programador (preço, foto, disponibilidade, horários).
- Histórico de pedidos e resumo de vendas por período.

## 5. Jornadas

### 5.1 Jornada do cliente

1. Recebe o link (Instagram, status do WhatsApp, Google) e abre no celular.
2. Vê o topo com a marca, o slogan e um aviso claro: **"Aberto agora"** ou **"Fechado — abrimos às 18:00"**.
3. Navega pelas categorias: Pizzas Clássicas, Pizzas Especiais, Bebidas e Adicionais Especiais.
4. Toca em uma pizza: escolhe **inteira** ou **meio a meio** (escolhendo o segundo sabor), marca adicionais (ex.: borda recheada), define a quantidade, escreve uma observação ("sem cebola") e adiciona ao carrinho. O preço aparece atualizado a cada escolha.
5. Adiciona bebidas com um toque.
6. Abre o carrinho, revisa, altera quantidades ou remove itens.
7. No checkout informa: nome, telefone, **entrega** (rua, número, bairro, referência) ou **retirada no balcão**, e forma de pagamento (**Pix**, **dinheiro** — com troco opcional — ou **cartão na maquininha**).
8. Toca em **"Enviar pedido pelo WhatsApp"**. O sistema confere tudo, registra o pedido e abre o WhatsApp com a mensagem pronta. O cliente só precisa tocar em "enviar".
9. O atendente responde pelo WhatsApp, combina a taxa de entrega (quando for o caso) e confirma.

### 5.2 Jornada do admin

1. Acessa `/admin` e entra com e-mail e senha (somente e-mails autorizados).
2. **Pedidos:** vê a lista do dia (ou de um período), abre um pedido para ver os detalhes e marca como **confirmado** ou **cancelado**.
3. **Resumo:** vê quantidade de pedidos, faturamento bruto estimado e os itens mais vendidos no período.
4. **Produtos:** cria, edita preço/descrição, envia foto e marca um item como **esgotado** com um toque.
5. **Horários:** ajusta o horário de cada dia da semana ou marca um dia como fechado.
6. **Loja:** força **aberta** ou **fechada** (ex.: feriado, falta de gás) ou deixa no **automático** (segue os horários).

## 6. Cardápio completo

Pizza em **tamanho único**. Valores em reais.

### Pizzas Clássicas

| Item | Descrição | Preço |
|---|---|---|
| Mista | Molho de tomate especial, mussarela, presunto, calabresa, cebola, azeitona e orégano | R$ 30,49 |
| Calabresa | Molho de tomate especial, mussarela, calabresa, cebola, azeitona e orégano | R$ 30,49 |
| Mussarela | Molho de tomate especial, mussarela, tomate, azeitona e orégano | R$ 30,49 |
| Marguerita | Molho de tomate especial, mussarela, manjericão, tomate, parmesão e orégano | R$ 34,90 |

> A descrição da Calabresa no cardápio impresso repetia "azeitona"; a versão acima já está corrigida.

### Pizzas Especiais

| Item | Descrição | Preço |
|---|---|---|
| Frango | Molho de tomate especial, mussarela, frango, milho, azeitona e orégano | R$ 34,99 |
| Portuguesa | Molho de tomate especial, mussarela, presunto, ovos, cebola, pimentão, milho, azeitona e orégano | R$ 34,99 |
| Bacon | Molho de tomate especial, mussarela, bacon, azeitona e orégano | R$ 39,99 |
| Carne do Sol | Molho de tomate especial, mussarela, carne do sol, cebola roxa, azeitona e orégano | R$ 42,99 |

### Bebidas

| Item | Descrição | Preço |
|---|---|---|
| Coca-Cola 600ml | — | R$ 6,00 |
| Coca-Cola 600ml Zero Açúcar | — | R$ 6,00 |
| Coca-Cola 1 Litro | — | R$ 10,00 |
| Coca-Cola 1 Litro Zero Açúcar | — | R$ 10,00 |
| Guaraná 1 Litro | — | R$ 8,00 |

### Adicionais Especiais (somente para pizzas)

| Item | Descrição | Preço |
|---|---|---|
| Borda Recheada com Catupiry | — | R$ 4,50 |
| Finalize com Catupiry por cima | Mais cremosidade e sabor em cada fatia | R$ 4,50 |
| Borda de Chocolate (Garoto ao Leite) | — | R$ 9,99 |

> "Catupiry" e "Garoto" são marcas e aparecem exatamente como no cardápio impresso.

## 7. Regras de negócio

1. **Tamanho único.** Toda pizza tem um só tamanho. O sistema já fica preparado para, no futuro, ter mais tamanhos.
2. **Inteira ou meio a meio.** A pizza pode ter 1 sabor (inteira) ou exatamente 2 sabores diferentes (meio a meio). Não existe pizza de 3 sabores.
3. **Preço da meio a meio = preço do sabor mais caro.**
   Ex.: Mussarela (R$ 30,49) + Carne do Sol (R$ 42,99) = **R$ 42,99**.
4. **Adicionais** valem só para pizzas, somam ao preço **de cada pizza**, e cada adicional pode ser escolhido no máximo uma vez por pizza.
   Ex.: 2 pizzas Calabresa/Frango com Borda Recheada com Catupiry = (R$ 34,99 + R$ 4,50) × 2 = **R$ 78,98**.
5. **Taxa de entrega não é calculada pelo site.** A mensagem informa "Taxa de entrega a combinar" e o atendente combina pelo WhatsApp.
6. **Retirada no balcão:** sem taxa e sem endereço.
7. **Pagamento:**
   - **Pix** — combinado no WhatsApp.
   - **Dinheiro** — o cliente pode informar "troco para R$ X"; o valor X precisa ser maior ou igual ao subtotal do pedido.
   - **Cartão** — na maquininha, na entrega ou na retirada.
   - Não há pagamento online no site.
8. **Horário de funcionamento** por dia da semana, com possibilidade de turno que passa da meia-noite (ex.: 18:00 às 00:30). O admin pode forçar a loja **aberta** ou **fechada**. **Pedidos fora do horário são recusados** pelo sistema, com mensagem amigável e o próximo horário de abertura.
9. **Itens esgotados** continuam aparecendo no cardápio, marcados como "Esgotado", e não podem ser pedidos.
10. **Preço sempre vem do cadastro.** Mesmo que alguém altere a página no navegador, o servidor recalcula tudo a partir do cardápio salvo.
11. **Código do pedido** sequencial no formato `BR-0001`, `BR-0002`…, citado na mensagem do WhatsApp para facilitar a conversa.
12. **Limites por pedido:** de 1 a 30 itens; cada item com quantidade de 1 a 20.

## 8. Identidade visual

### 8.1 Paleta

| Papel | Cor | Hex | Uso |
|---|---|---|---|
| Fundo principal | Verde-escuro | `#0F3D2E` | Fundo das páginas |
| Fundo alternativo | Verde-escuro 2 | `#14432F` | Cartões, faixas, cabeçalho |
| Destaque | Dourado | `#D4A93C` | Títulos, preços, botões principais |
| Destaque claro | Dourado claro | `#E8C468` | Hover/realces, ícones |
| Texto | Creme | `#F3E9D2` | Texto corrido e descrições |
| Acento | Tijolo | `#8B3A2B` | Detalhes, selos ("Esgotado"), bordas decorativas |
| Acento | Madeira | `#6B4423` | Texturas e divisores |
| Acento | Brilho do forno | `#E86A2C` | Pequenos realces (ex.: "Aberto agora") |
| Mascote | Vermelho lambreta | `#C62828` | Ilustração do mascote, nunca para texto |

> Verde e dourado/creme vêm do cardápio impresso. Os tons de acento (tijolo, madeira, forno, vermelho) são uma proposta de interpretação e podem ser ajustados.
> Contraste estimado: dourado `#D4A93C` sobre `#0F3D2E` ≈ 5,5:1 e creme `#F3E9D2` sobre `#0F3D2E` ≈ 10:1 — ambos atendem WCAG AA (validar com ferramenta na implementação).

### 8.2 Tipografia

- **Títulos:** Oswald — condensada, caixa alta (nome de categoria, nome da pizza, preços).
- **Destaques:** Pacifico — script, uso pontual (slogan, "Peça agora e saboreie!", selos).
- **Corpo:** Inter — legível em telas pequenas (descrições, formulários).
- Fontes do Google Fonts com `font-display: swap`.

### 8.3 Tom de voz

Caloroso, direto e de pizzaria de bairro. Frases curtas, sem jargão técnico, tratando o cliente por "você".
Exemplos: "Bateu a fome? Monte sua pizza.", "Ops, essa acabou por hoje.", "Estamos fechados agora — abrimos hoje às 18:00.", "Pronto! É só tocar em enviar no WhatsApp."

### 8.4 Mascote e slogan

- **Mascote:** chef de bigode pilotando uma lambreta vermelha — usado no topo do site, na tela de "loja fechada" e na tela de carrinho vazio.
- **Slogan:** "Peça agora e saboreie!" — sempre em Pacifico, em dourado.

## 9. Escopo

### 9.1 Dentro do MVP

- Cardápio público responsivo (mobile-first) com categorias, fotos, descrições, preços e selo "Esgotado".
- Indicador de loja aberta/fechada e bloqueio de pedidos fora do horário.
- Montagem de pizza inteira ou meio a meio, com adicionais, quantidade e observação.
- Carrinho que fica salvo no aparelho (sobrevive a recarregar a página).
- Checkout com entrega ou retirada, e pagamento em Pix, dinheiro (com troco) ou cartão.
- Registro do pedido no banco com código `BR-XXXX` e abertura do WhatsApp com mensagem pronta.
- Painel admin com login: produtos (criar, editar, excluir quando nunca vendido, foto, esgotado), horários, abrir/fechar loja, histórico de pedidos com filtro por data, mudança de status (recebido/confirmado/cancelado) e resumo de vendas.

### 9.2 Fora do MVP (futuro)

- Pagamento online (Pix automático, cartão no site).
- Cálculo automático de frete por bairro/distância.
- Cupons e promoções.
- Login/cadastro de cliente e histórico do cliente.
- Aplicativo nativo.
- Impressão automática de pedidos na cozinha.
- Acompanhamento do pedido em tempo real pelo cliente.
- Múltiplos tamanhos de pizza (o modelo de dados já permite evoluir).

## 10. Critérios de sucesso (mensuráveis)

| # | Critério | Meta | Como medir |
|---|---|---|---|
| 1 | Tempo para montar e enviar um pedido típico (1 pizza meio a meio + 1 bebida, entrega) no celular | **< 2 minutos** | Teste com 5 pessoas usando celular comum, cronometrado |
| 2 | Desempenho do cardápio no celular | **Lighthouse mobile ≥ 90** em Performance, Acessibilidade e Boas Práticas | Lighthouse na URL de produção |
| 3 | Divergência de preço entre site, banco e mensagem | **Zero** | Testes automatizados de preço + conferência de 20 pedidos reais no primeiro mês |
| 4 | Pedidos aceitos fora do horário | **Zero** | Teste automatizado + verificação no histórico |
| 5 | Mensagens que precisaram ser corrigidas pelo atendente por falta de dado (endereço, pagamento) | **< 5%** dos pedidos no primeiro mês | Registro do atendente |
| 6 | Atualização de cardápio (preço/esgotado) feita pelo próprio Barão | **< 1 minuto** por alteração, sem ajuda técnica | Teste com o dono |
| 7 | Acessibilidade básica | Contraste AA, alvos de toque ≥ 44 px, navegação por teclado no modal | Lighthouse + revisão manual |

## 11. Riscos e premissas

### Premissas

- O cliente tem WhatsApp instalado no celular (ou WhatsApp Web no computador).
- O atendimento continua no WhatsApp; o site organiza o pedido, mas a confirmação final é humana.
- A taxa de entrega é combinada caso a caso.
- O Barão fornecerá fotos, horários reais e os e-mails de quem acessará o painel.
- Hospedagem em serviço gerenciado (servidor Node + Supabase), com custo baixo ou gratuito no início.

### Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Cliente não toca em "enviar" no WhatsApp após o pedido ser registrado | Pedido no histórico que nunca chegou ao atendente | Status `received` só vira `confirmed` quando o atendente confirma; o painel destaca pedidos não confirmados |
| Cardápio desatualizado (preço/esgotado) | Atrito com o cliente | Painel simples, botão de "esgotado" com um toque |
| Horários errados | Pedidos recusados ou aceitos indevidamente | Horários reais confirmados antes do lançamento; override manual |
| Fotos ausentes ou pesadas | Site lento e menos atrativo | Placeholder com a identidade visual; upload com limite de 2 MB e formato webp recomendado |
| Abuso (envio repetido de pedidos falsos) | Ruído no histórico | Limite de 10 pedidos a cada 10 minutos por IP; validação forte |
| Plano gratuito de hospedagem "dorme" e demora no primeiro acesso | Primeira visita lenta | Plano pago básico ou monitor de disponibilidade |
| Mudança na URL/comportamento do `wa.me` | Mensagem não abre | Link `wa.me` é padrão estável; mostrar o código do pedido e o número na tela como alternativa |

## 12. Pendências a confirmar com o dono

1. **Horários reais de funcionamento** por dia da semana (o sistema nasce com 18:00–23:30 todos os dias apenas como valor provisório — CONFIRMAR COM O DONO). Há dia de folga? Algum turno passa da meia-noite?
2. **Chave Pix:** deseja exibir a chave Pix no site/mensagem ou prefere enviar pelo WhatsApp? Se exibir, qual chave e em nome de quem.
3. **Fotos dos produtos:** fotos próprias de cada pizza e bebida (ideal: quadradas, boa luz, ≥ 800 px). Enquanto não houver, usaremos imagem padrão com a identidade visual.
4. **Domínio:** usará domínio próprio (ex.: `pizzariabarao.com.br`) ou subdomínio da hospedagem? Quem registra?
5. **E-mails do admin:** quais e-mails terão acesso ao painel.
6. **Meio a meio entre Clássica e Especial:** pode misturar (ex.: Mussarela + Carne do Sol)? **Padrão adotado: sim**, cobrando o sabor mais caro.
7. **Adicionais na meio a meio:** valem para pizza meio a meio? **Padrão adotado: sim.**
8. **Duas bordas na mesma pizza:** "Borda Recheada com Catupiry" e "Borda de Chocolate" podem ser escolhidas juntas? **Padrão adotado: sim** (cada adicional no máximo 1x por pizza), até orientação contrária.
9. **Preço da Marguerita:** confirmar R$ 34,90 (as demais especiais/clássicas terminam em ,49 ou ,99).
10. **Logo e mascote em arquivo** (vetor ou PNG em alta resolução) para uso no site.
11. **Número do WhatsApp** (85) 99768-7641 é o definitivo para receber pedidos?
12. **Bairros atendidos:** há bairros onde não entregam? (O MVP não bloqueia por bairro; serviria para um aviso no checkout.)
