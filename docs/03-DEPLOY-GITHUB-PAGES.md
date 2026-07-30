# 03 — Publicar no GitHub Pages

O GitHub Pages serve arquivos estáticos de graça, com HTTPS. Como o portal não
precisa de build, publicar é só empurrar os arquivos.

---

## Antes de começar, entenda uma coisa

O GitHub Pages **só serve arquivos**. Ele não roda Node, não roda Python, não
roda banco de dados. Então quem faz o trabalho de servidor é o **Supabase**.

Consequência prática: **você precisa ter feito o
[`02-SUPABASE-SETUP.md`](02-SUPABASE-SETUP.md) antes.** Sem isso, o portal
publicado vai abrir em modo demonstração, e cada pessoa vai ver apenas os dados
salvos no próprio navegador.

E mais uma: uma página em `https://` **não consegue** chamar
`http://localhost:3333`. O navegador bloqueia mistura de HTTPS com HTTP, e está
certo em bloquear. Por isso o back-end Express não entra nessa história — a
leitura do boleto acontece no navegador.

---

## Caminho 1 — Publicar a pasta `frontend` inteira (mais simples)

### Passo 1 — Colocar as chaves no `config.js`

Antes de subir, `frontend/js/config.js` precisa ter a URL e a chave `anon`
preenchidas. Elas vão ficar visíveis no código publicado — **isso é esperado e
seguro**, porque a proteção real é o RLS do banco.

### Passo 2 — Criar o repositório e subir

```bash
cd portal-boletos-serena

git init
git add .
git commit -m "Portal de associacao de boletos"

git branch -M main
git remote add origin https://github.com/SEU-USUARIO/portal-boletos-serena.git
git push -u origin main
```

### Passo 3 — Ligar o Pages

No repositório: **Settings** → **Pages**

- **Source:** `Deploy from a branch`
- **Branch:** `main`
- **Folder:** `/frontend`  ← importante
- **Save**

Espere 1 ou 2 minutos. O endereço aparece na própria página:

```
https://SEU-USUARIO.github.io/portal-boletos-serena/
```

### Passo 4 — Voltar ao Supabase e liberar o endereço novo

Isto é o passo que todo mundo esquece.

**Authentication** → **URL Configuration**:

- **Site URL:** `https://SEU-USUARIO.github.io/portal-boletos-serena`
- **Redirect URLs:** acrescente
  `https://SEU-USUARIO.github.io/portal-boletos-serena/**`

Sem isso, o link de confirmação de e-mail leva a pessoa para uma página de erro.

---

## Caminho 2 — Publicar com GitHub Actions (mais organizado)

Vantagem: o endereço fica na raiz, sem o `/frontend` no caminho.

Crie o arquivo `.github/workflows/publicar.yml`:

```yaml
name: Publicar no GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  publicar:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.publicacao.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - name: Configurar o Pages
        uses: actions/configure-pages@v5

      - name: Enviar apenas a pasta frontend
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./frontend

      - name: Publicar
        id: publicacao
        uses: actions/deploy-pages@v4
```

Depois: **Settings** → **Pages** → **Source:** `GitHub Actions`.

A cada `git push` na `main`, o portal se atualiza sozinho.

---

## O arquivo `.nojekyll`

Já está em `frontend/.nojekyll`. Ele existe porque o GitHub Pages, por padrão,
passa os arquivos por um programa chamado Jekyll, que **ignora pastas e arquivos
que começam com `_`**. O arquivo vazio `.nojekyll` desliga isso.

Confirme que ele foi junto:

```bash
git ls-files frontend/.nojekyll
```

Se não aparecer nada:

```bash
git add -f frontend/.nojekyll
git commit -m "Adiciona .nojekyll"
git push
```

---

## Sobre os caminhos relativos

Todo caminho no portal usa `./` — por exemplo `./css/app.css`, não
`/css/app.css`. Isso é de propósito: no Caminho 1 o portal fica numa
subpasta (`/portal-boletos-serena/`), e caminhos que começam com `/` iriam
procurar na raiz do domínio e dar 404.

Se você for mexer no HTML, **mantenha o `./`**.

---

## Testar depois de publicar

Abra o endereço numa **janela privada** (para não usar sessão antiga) e confira:

- [ ] O logo e as fontes carregam (se não, é problema de caminho)
- [ ] **Não** aparece a faixa amarela de modo demonstração
- [ ] Consegue criar conta e o e-mail de confirmação chega
- [ ] O link do e-mail volta para o portal, não para uma página de erro
- [ ] Um dos 13 e-mails vê a escolha das duas visões
- [ ] Anexar um boleto lê valor e vencimento
- [ ] O boleto enviado aparece no painel do operador
- [ ] Os quatro cartões mudam sozinhos
- [ ] O clipe baixa o arquivo
- [ ] Digitar um endereço inexistente cai na página 404 bonita

---

## Se o repositório precisa ser privado

GitHub Pages em repositório privado exige plano pago (Team ou Enterprise). Duas
alternativas de graça, ambas conectando no mesmo GitHub:

- **Cloudflare Pages** — build command vazio, output directory `frontend`
- **Netlify** — publish directory `frontend`

Nos dois casos, lembre de acrescentar o endereço novo nas **Redirect URLs** do
Supabase.

---

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| 404 na página inteira | Pasta errada em Settings → Pages | Escolha `/frontend` |
| Página carrega sem estilo | Caminho absoluto no HTML | Troque `/css/` por `./css/` |
| Fontes não carregam | A pasta `assets` não subiu | `git add -f frontend/assets` |
| "Invalid Redirect URL" ao confirmar e-mail | Endereço não cadastrado | Acrescente nas Redirect URLs do Supabase |
| Modo demonstração ainda ativo | `config.js` subiu sem chaves | Preencha, `git push`, e recarregue com Ctrl+Shift+R |
| Mudança não aparece | Cache do navegador ou do Pages | Ctrl+Shift+R; espere 2 minutos |
| Erro de CORS ao chamar o banco | Endereço não liberado no Supabase | Mesma correção das Redirect URLs |
