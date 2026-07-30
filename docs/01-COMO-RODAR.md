# 01 — Como rodar

Três caminhos. Comece pelo primeiro: ele funciona sem você configurar nada.

---

## Caminho A — Ver funcionando agora (modo demonstração)

Você só precisa de um jeito de servir arquivos. Escolha uma opção:

### Com Python (já vem instalado no Mac e no Linux)

```bash
cd portal-boletos-serena/frontend
python3 -m http.server 8080
```

### Com Node

```bash
cd portal-boletos-serena/frontend
npx serve -l 8080
```

### Com PHP

```bash
cd portal-boletos-serena/frontend
php -S localhost:8080
```

Agora abra: **<http://localhost:8080>**

> **Por que preciso de um servidor? Não posso só dar dois cliques no arquivo?**
>
> Não. O portal usa módulos de JavaScript (`import`/`export`), e navegador
> nenhum aceita módulo aberto como `file:///...` — é uma regra de segurança
> chamada CORS. Precisa vir por `http://`. Qualquer um dos comandos acima
> resolve.

### O que fazer na tela

O login é a **primeira** tela — não tem vitrine antes da porta.

1. Digite um e-mail da equipe (ex. `kelly.silva@srna.co`) e qualquer senha.
2. Vai dar erro, e é o esperado: a conta existe mas ainda não foi ativada.
   Aparece o botão **Primeiro acesso**, com o e-mail já preenchido.
3. Clique nele e peça o link. Na demonstração não há e-mail de verdade, então o
   link aparece na própria tela, avisando que é simulação.
4. Abra o link, escolha uma senha de 8 caracteres e entre.
5. Sendo operador, aparece a escolha entre as duas visões. Depois, o botão no
   topo troca de lado quando quiser.

Para ver cada tipo de acesso:

| E-mail | O que você vê |
|---|---|
| `kelly.silva@srna.co` | Operador de **notas fiscais** (5 boletos) |
| `thais.lima@srna.co` | Operador de **medições** (2 boletos) |
| `joao.vicente@srna.co` | As **duas filas**, com alternador e contadores |
| `sit.pedro.moreira@ext.srna.co` | Idem — terceirizado, mesmos poderes |
| qualquer outro `@srna.co` | Solicitante comum |

Os 7 boletos de exemplo somam os números do layout: R$ 21.090, 4 pendentes,
3 associados. Divididos em 5 notas fiscais e 2 medições, para o escopo ficar
visível.

**Dica boa para testar o tempo real:** abra duas abas — uma no formulário do
cliente, outra no painel do operador. Envie um boleto numa e olhe os quatro
cartões mudarem na outra.

---

## Caminho B — Rodar com o banco de verdade

### Passo 1 — Criar o banco

Siga [`02-SUPABASE-SETUP.md`](02-SUPABASE-SETUP.md). Leva uns 15 minutos e é
grátis.

### Passo 2 — Colocar as chaves

Abra `frontend/js/config.js` e preencha as duas primeiras linhas:

```js
export const CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  // ...
```

Salve. O portal detecta as chaves e **sai** do modo demonstração sozinho — a
faixa amarela desaparece.

> A chave `anon` é pública de propósito. Ela pode aparecer no navegador sem
> risco, porque quem protege os dados é o RLS do banco, não o segredo da chave.
> A chave que **nunca** pode aparecer é a `service_role` — essa fica só no
> `backend/.env`.

### Passo 3 — Servir os arquivos

O mesmo comando do Caminho A:

```bash
cd frontend
python3 -m http.server 8080
```

### Passo 4 — Criar sua conta

Vá em <http://localhost:8080/login.html>, aba **Criar conta**. Use seu e-mail
`@srna.co` de verdade, porque agora chega um e-mail para confirmar.

Se seu e-mail está entre os 13 da equipe, sua conta **já nasce como operador**.
Não precisa fazer mais nada.

---

## Caminho C — Rodar o back-end também (opcional)

Só faz diferença se você quer ler boletos por linha de comando ou recarregar a
tabela de unidades.

```bash
cd backend
npm install
cp .env.example .env
```

Abra o `.env` e preencha. Depois:

```bash
npm start
```

Confira se subiu:

```bash
curl http://localhost:3333/api/saude
```

### Ler um boleto pelo terminal

```bash
curl -F arquivo=@/caminho/do/boleto.pdf \
  http://localhost:3333/api/extracao/arquivo
```

### Conferir uma linha digitável

```bash
curl -X POST http://localhost:3333/api/extracao/codigo \
  -H "Content-Type: application/json" \
  -d '{"codigo":"00190500954014481606906809350314337370000000100"}'
```

### Rodar os testes

```bash
cd backend
npm test
```

Deve terminar com `40 passaram, 0 falharam`.

---

## Importar sua planilha de unidades

```bash
cd tools
npm install

# Primeiro, veja o que tem dentro do Excel:
node excel-para-json.mjs --arquivo "../Mapeamento_Geral_de_Contas_2023_Equipe.xlsx" --inspecionar

# Depois, importe (a aba BASE GERAL já é o padrão):
node excel-para-json.mjs --arquivo "../Mapeamento_Geral_de_Contas_2023_Equipe.xlsx"
```

Sua planilha já foi importada: **213 empresas** e **1.073 contas ativas** estão
em `frontend/data/contas-bancarias.json` e em `db/07_seed_contas.sql`.

O resto está em [`06-COMO-ENVIAR-O-EXCEL.md`](06-COMO-ENVIAR-O-EXCEL.md).

---

## Quando algo dá errado

| Sintoma | O que é | Como resolver |
|---|---|---|
| Tela branca, console diz "Failed to load module script" | Você abriu como `file://` | Use um dos comandos de servidor acima |
| "Address already in use" | A porta 8080 está ocupada | Troque para 8081 |
| Faixa amarela não sai | As chaves não foram lidas | Confira se salvou o `config.js` e recarregue com Ctrl+Shift+R |
| Não recebo o e-mail de confirmação | SMTP não configurado, ou limite do serviço embutido | Veja [`08-EMAIL-DE-VERDADE.md`](08-EMAIL-DE-VERDADE.md) |
| Entrei mas não sou operador | Seu e-mail não estava em `admin_emails` | Rode `db/06_seed_admins.sql`; a automação corrige o papel na hora |
| Vejo só NF, mas preciso de MD | Seu escopo está fixo | `update admin_emails set escopo='ambos' where email='...'` e recarregue |
| "Esta conta ainda não foi ativada" | É o esperado no primeiro login | Use o **Primeiro acesso** |
| Não achei o botão Primeiro acesso | Ele só aparece após uma tentativa | Tente entrar uma vez; ele surge abaixo |
| O clipe não baixa nada | Boleto de exemplo não tem arquivo real | Envie um boleto de verdade |
| "Não consegui ler este arquivo" | PDF escaneado ou protegido | Preencha à mão, ou cole a linha digitável no campo indicado |
| 404 ao publicar no GitHub Pages | Falta o `.nojekyll` ou a pasta está errada | Veja [`03-DEPLOY-GITHUB-PAGES.md`](03-DEPLOY-GITHUB-PAGES.md) |
