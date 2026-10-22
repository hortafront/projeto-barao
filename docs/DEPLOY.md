# Deploy do Barão – Delivery de Pizza

Guia passo a passo para colocar o cardápio no ar: Supabase (banco, login do admin, imagens) + Render (ou Railway) para o servidor Node.

Requisitos: Node **22+** (`engines` do `package.json`), conta no Supabase e conta no Render/Railway, repositório no GitHub.

## 1. Criar o projeto no Supabase

1. Em <https://supabase.com>, **New project**. Escolha a região **South America (São Paulo) – `sa-east-1`** e guarde a senha do banco.
2. Aguarde o projeto ficar pronto.

## 2. Aplicar as migrations

No painel do Supabase abra **SQL Editor** e rode, **nesta ordem** (cole o conteúdo inteiro de cada arquivo):

1. `supabase/migrations/0001_schema.sql` (tabelas, RLS, sequence, funções `create_order`/`next_order_code`, bucket `product-images`)
2. `supabase/migrations/0002_seed_cardapio.sql` (cardápio, horários e configurações iniciais)
3. `supabase/migrations/0003_clientes.sql` (contas de cliente: `customers`, `customer_addresses`, `orders.customer_id` e `create_order` atualizada)

Alternativa: Supabase CLI (`supabase link` + `supabase db push`).

Regra: **nunca edite uma migration já aplicada em produção**. Mudanças futuras vão em `0004_*.sql`, `0005_*.sql`...

## 3. Autenticação: admin e contas de cliente

O mesmo Supabase Auth atende o painel do dono e as contas de cliente. O **cadastro público fica ligado** (o cliente precisa criar conta para finalizar o pedido); o painel continua protegido por `ADMIN_EMAILS`, então um cliente comum recebe 403 em `/admin`.

1. **Authentication → Users → Add user → Create new user**: e-mail `guslolhorta@gmail.com`, uma senha forte, marque *Auto Confirm User* (usuário admin).
2. **Authentication → Sign In / Providers → Email**:
   - **Allow new users to sign up**: **ligado**.
   - **Confirm email**: **desligado** (o cliente entra logo após criar a conta).
   - **Minimum password length**: **8**.
3. **Authentication → SMTP Settings**: configure um serviço de e-mail (Resend ou outro SMTP).
   > **Sem SMTP, "Esqueci minha senha" não funciona em produção.** O resto (criar conta, entrar, pedir) funciona.
4. **Authentication → URL Configuration**:
   - **Site URL**: `https://<domínio>`
   - **Redirect URLs**: `https://<domínio>/conta/nova-senha.html`
5. Somente e-mails listados em `ADMIN_EMAILS` entram no painel, mesmo que existam outros usuários no Auth.

## 4. Pegar as chaves

Em **Project Settings → API**:

- `SUPABASE_URL`: Project URL (`https://xxxx.supabase.co`)
- `SUPABASE_ANON_KEY`: chave `anon` / publishable (pública; usada só nos logins do admin e do cliente)
- `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role` / secret (**secreta**, só no servidor; nunca em `public/`, log ou commit)

## 5. Deploy no Render (ou Railway)

**Render → New → Web Service**, apontando para o repositório:

| Campo | Valor |
|---|---|
| Runtime | Node (versão **22**; defina `NODE_VERSION=22` se necessário) |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/status` |
| Região | a mais próxima do Brasil disponível (São Paulo se houver; senão EUA leste) |

No Railway é equivalente: build `npm ci`, start `npm start`, healthcheck `/api/status`.

O `npm start` roda `node src/server.js` **sem** `--env-file`: em produção as variáveis vêm do painel da hospedagem. Se faltar alguma obrigatória, o servidor encerra com uma mensagem dizendo qual.

Plano gratuito "dorme" e o primeiro pedido seria lento: prefira o plano pago básico ou um ping de disponibilidade em `/api/status`.

### Variáveis de ambiente

| Variável | Valor | Observação |
|---|---|---|
| `PORT` | (a plataforma define) | |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Secreta |
| `SUPABASE_ANON_KEY` | `eyJ...` | Pública |
| `ADMIN_EMAILS` | `guslolhorta@gmail.com` | Vários: separados por vírgula |
| `CORS_ORIGIN` | URL do site, ex.: `https://cardapio.seudominio.com.br` | URL pública do site, sem barra no final; ajuste quando o domínio mudar. Vazio bloqueia chamadas vindas de outras origens (tudo bem quando site e API estão no mesmo domínio) |
| `STORE_TIMEZONE` | `America/Fortaleza` | |
| `TRUST_PROXY` | `1` | Atrás do proxy do Render/Railway; sem isso o rate limit enxerga o IP do proxy |
| `NODE_ENV` | `production` | Liga `upgrade-insecure-requests` na CSP |

## 6. Domínio

1. Na hospedagem: **Settings → Custom Domains**, adicione o domínio/subdomínio.
2. No registro do domínio, crie o **CNAME** apontando para o endereço indicado. O HTTPS é emitido pela plataforma.
3. Atualize `CORS_ORIGIN` para a URL final e faça novo deploy. Depois de trocar o domínio, não é preciso mexer no CSP (as origens externas são o Supabase, vindo de `SUPABASE_URL`, o Google Fonts e o `cdn.jsdelivr.net`).

## 7. Backups

- O Supabase faz backups diários no plano (confira a retenção do seu plano).
- **Semanal, fora do Supabase:** `supabase db dump -f backup-AAAA-MM-DD.sql` (CLI) guardado em outro lugar (ex.: drive da pizzaria), mantendo as **8 últimas semanas**.
- Imagens: o bucket `product-images` é reconstituível; guarde as **fotos originais** em pasta compartilhada.
- **Teste de restauração** antes do lançamento e a cada trimestre (restaurar o dump num projeto Supabase de teste).

## Pendências do dono

- **Número definitivo do WhatsApp**: alterar pelo painel, aba **Loja** (só dígitos, formato `55` + DDD + número). O valor atual vem do seed (`settings.whatsapp_number`): provisoriamente `5585992732247` — (85) 99273-2247 —, até o dono enviar o número definitivo.
- **Fotos dos produtos**: o dono envia; subir pelo painel (Produtos → editar → foto, jpeg/png/webp até 2 MB). Até lá aparece o placeholder.
- **Logo e mascote**: enviar os arquivos para colocar em `public/img/`.
- **Domínio** do site (define o `CORS_ORIGIN`).

## Checklist de verificação manual

Nada abaixo foi executado automaticamente (exige Supabase real, navegador, celular ou Lighthouse). Marque cada item no ambiente publicado (HTTPS), em **celular real, 4G**. Registre as notas do Lighthouse no PR.

### Banco / Supabase

- [ ] Rodar `0001`, `0002` e `0003` (nessa ordem) no projeto real sem erro (pgcrypto, RLS, grants do `service_role`, policies do bucket).
- [ ] RLS efetivo: com a chave `anon` direto na API REST do Supabase, as tabelas não devolvem dados.
- [ ] Smoke test da API (`.env` preenchido, `npm run dev`):
  ```bash
  curl -s localhost:3000/api/menu | head -c 300
  curl -s localhost:3000/api/status
  curl -s -X POST localhost:3000/api/orders -H 'Content-Type: application/json' -d @tmp/pedido.json   # ids reais do /api/menu; 201 ou 409 STORE_CLOSED conforme a hora
  curl -s localhost:3000/api/admin/settings                                                          # 401
  TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d '{"email":"guslolhorta@gmail.com","password":"..."}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token))")
  curl -s localhost:3000/api/admin/orders -H "Authorization: Bearer $TOKEN"
  curl -s -X POST localhost:3000/api/admin/products/<id>/image -H "Authorization: Bearer $TOKEN" -F image=@foto.webp
  ```
- [ ] No painel Supabase: pedido e itens gravados, imagem no bucket, URL pública abre. Apagar os dados de teste depois.
- [ ] Segundo upload de imagem do mesmo produto remove a primeira do bucket; excluir produto remove a imagem.
- [ ] Excluir produto que já tem pedido (GIN em `product_ids`) devolve 409 `PRODUCT_HAS_ORDERS`.
- [ ] Listagem de pedidos e Resumo tratam `from`/`to` como dias locais de Fortaleza (pedido às 22:00 locais cai no dia certo).
- [ ] Teste de restauração de backup feito.

### Site do cliente

- [ ] Abrir pelo link real (HTTPS) em Android e iPhone; selo Aberto/Fechado correto para a hora de Fortaleza.
- [ ] Largura de 360 px: wordmark, slogan, abas, placeholders de pizza/bebida, foco, toast e drawer sem erro de console nem rolagem horizontal.
- [ ] Rolar categorias pelas abas (a aba acompanha a rolagem); banner aberto/fechado; esqueleto de carregamento e erro com "Tentar de novo".
- [ ] Produto esgotado aparece como "Esgotado" e não adiciona; loja fechada desabilita os botões de adicionar.
- [ ] Modal da pizza: foco preso, `Esc` fecha e devolve o foco, clique no fundo fecha, layout em 360/768 px, contraste do botão desabilitado.
- [ ] Montar meio a meio + adicional + observação e bebida x2: preço do modal = carrinho = subtotal da confirmação.
- [ ] Recarregar: o carrinho continua; esgotar um item no admin e recarregar: o item sai com aviso.
- [ ] Checkout entrega com troco e retirada com Pix até a confirmação; erros de campo aparecem e focam o campo; máscara do telefone; navegação por teclado; 360 px sem rolagem horizontal.
- [ ] Toque duplo em "Enviar" gera um único pedido; tocar no fundo durante "Enviando…" mantém o diálogo e envia 1 POST; fechar à força durante o envio e reabrir mostra o mesmo formulário e o resultado, sem 2º POST.
- [ ] Loja fechada ou produto indisponível no envio: mensagem clara.
- [ ] Confirmação mostra o código `BR-XXXX`; "Abrir WhatsApp" abre a conversa com o número da loja e o texto completo (acentos e emoji corretos).

### Conta do cliente

Exige SMTP configurado (item 3 da seção 3) e e-mail real.

- [ ] Criar conta (nome, telefone, e-mail, senha de 8+ caracteres): entra logado, sem confirmar e-mail; "Entrar" do header vira "Minha conta".
- [ ] Fazer um pedido logado: nome, telefone e endereço salvo vêm pré-preenchidos; o pedido é gravado com `customer_id`; "Finalizar pedido" sem login abre a janela de login com o carrinho intacto.
- [ ] Sair e entrar de novo (e recarregar a página: continua logado até "Sair").
- [ ] "Esqueci minha senha" com e-mail real: o e-mail chega, o link abre `/conta/nova-senha.html`, a nova senha (mín. 8) funciona e volta ao cardápio logado.
- [ ] "Minha conta": editar nome e telefone, adicionar/editar/apagar endereço, "Tornar padrão"; "Salvar este endereço" no checkout salva após o pedido.
- [ ] Excluir minha conta: usuário some do Auth, perfil e endereços são apagados e os pedidos anteriores continuam no painel admin (com `customer_id` nulo).
- [ ] Conta de cliente comum não acessa `/admin` (403).

### Painel admin

- [ ] Login válido leva a `/admin/painel.html#pedidos`; e-mail fora de `ADMIN_EMAILS` mostra a mensagem de acesso negado; senha errada mostra "E-mail ou senha inválidos."; apagar o `sessionStorage` leva a "Sua sessão expirou".
- [ ] Navegação (abas e botão voltar), banner de override, import do supabase-js pela CDN liberado pela CSP, alvos de toque e área segura no celular.
- [ ] Produtos: editar preço reflete no site; marcar esgotado; upload > 2 MB ou `.gif` é bloqueado com prévia; criar com foto; excluir produto já vendido mostra o fluxo do 409; selo "Borda"; uso com uma mão em 360 px.
- [ ] Horários: salvar turno 18:00 -> 00:30; refletir no site e no `/api/status`.
- [ ] Loja: forçar Fechada -> site mostra Fechado e `POST /api/orders` devolve `STORE_CLOSED`; voltar para Automático; trocar o número -> `wa.me/<novo>` na confirmação; layout no celular.
- [ ] Pedidos: pedido novo aparece; confirmar, cancelar e voltar; "carregar mais" além de 20; link do WhatsApp; atualiza ao voltar para a aba (`visibilitychange`); layout no celular.
- [ ] Resumo confere com a lista de pedidos.

### Desempenho e acessibilidade

- [ ] `npm test` verde e sem `.only`/`.skip` esquecidos (`grep -rn "\.only\|\.skip\|todo:" tests`).
- [ ] Lighthouse mobile (DevTools ou PageSpeed Insights) **>= 90** em Performance, Acessibilidade, Boas práticas e SEO. Anotar as notas no PR.
- [ ] Navegação só por teclado (desktop) no fluxo de compra e leitor de tela básico (TalkBack/VoiceOver).
- [ ] Cabeçalhos em produção: HTML com `Cache-Control: no-cache`; `/js`, `/css`, `/shared`, `/img` com `max-age=3600` (DevTools -> Network).
