# Portal de Associação de Boletos — Serena Energia

Portal onde as pessoas enviam boletos de fornecedores e a equipe de operação faz
a associação. Roda **na sua máquina** e também no **GitHub Pages**.

**Comece por aqui:** [`docs/01-COMO-RODAR.md`](docs/01-COMO-RODAR.md) — em dois
comandos você vê o portal funcionando com dados de exemplo.

Para entender o *porquê* de cada decisão: [`PRD.md`](PRD.md).

---

## Começar em 30 segundos

```bash
cd frontend
python3 -m http.server 8080
```

Abra <http://localhost:8080>. Não precisa configurar nada: o portal entra em
**modo demonstração** com 7 boletos de exemplo.

O login é a primeira tela. Os e-mails da equipe já vêm cadastrados **sem
senha**, igual ao portal de verdade: tentar entrar dá erro e abre o caminho do
**Primeiro acesso**, onde o link de ativação aparece na própria tela (na
demonstração não existe e-mail de verdade).

Para ver cada tipo de acesso:

| Use este e-mail | Você vê |
|---|---|
| `kelly.silva@srna.co` | Operador de **notas fiscais** |
| `thais.lima@srna.co` | Operador de **medições** |
| `joao.vicente@srna.co` | Operador das **duas filas**, com alternador |
| qualquer outro `@srna.co` | Solicitante comum |

---

## O que tem dentro

```
portal-boletos-serena/
├── PRD.md                  O documento que explica tudo
├── README.md               Este arquivo
├── docs/                   Os guias, um por assunto
│
├── frontend/               O portal. É isto que vai para o GitHub Pages.
│   ├── index.html            Tela inicial, com o cartão do serviço
│   ├── login.html            Entrar, criar conta, confirmar e-mail
│   ├── cliente.html          Formulário de envio + "meus boletos"
│   ├── operador.html         Os 4 cartões + a tabela
│   ├── css/app.css           Todo o estilo, na marca Serena
│   ├── data/                 213 empresas e 1.127 contas bancárias
│   ├── assets/               Logos e fontes da marca
│   └── js/
│       ├── config.js           ⚠️  ONDE VOCÊ COLOCA AS CHAVES
│       ├── boleto-parser.js    A matemática do boleto (44/47/48 dígitos)
│       ├── extrator.js         Lê o PDF/imagem no navegador
│       ├── dados.js            Escolhe entre demo e Supabase
│       ├── dados-demo.js       Modo demonstração (localStorage)
│       ├── dados-supabase.js   Modo real
│       ├── sessao.js           Quem está logado e em qual visão
│       ├── contas.js           Empresas, contas e busca com romanos
│       ├── boleto-campos.js    Garimpa CNPJ, nº do documento e fornecedor
│       ├── layout.js           Topo e rodapé
│       ├── ui.js              Ícones, formatação, avisos, modais
│       └── pagina-*.js         Um por tela
│
├── db/                     O banco, em 8 arquivos numerados
├── backend/                Servidor Express OPCIONAL
└── tools/                  O importador do seu Excel
```

---

## Os três modos de rodar

| Modo | Precisa de que | Serve para |
|---|---|---|
| **Demonstração** | Nada | Ver funcionando agora, mostrar para alguém |
| **Local + Supabase** | Conta grátis no Supabase | Usar de verdade, testando na sua máquina |
| **GitHub Pages + Supabase** | O mesmo + um repositório | Usar de verdade, o time todo |

O passo a passo de cada um está em `docs/`.

---

## As decisões que valem saber antes de mexer

**1. O boleto não é lido por adivinhação.** O valor e o vencimento estão
codificados dentro do código de barras, com dígito verificador. O sistema
**calcula** e **confere**. O OCR é o último recurso, não o primeiro.
Detalhes na seção 4 da PRD.

**2. A segurança está no banco, não na tela.** O RLS do Postgres decide quem vê
o quê. O JavaScript é só conveniência. Mexer no navegador não abre nada.

**3. Cada operador vê só o seu tipo de documento.** NF, MD ou as duas, conforme
o escopo. E isso está no RLS do banco, não só num filtro de tela.

**4. O primeiro acesso manda um link, não define a senha na hora.** É o que
impede alguém de criar senha para um colega. Detalhes em `docs/07`.

**5. O back-end é opcional.** O Supabase já é o back-end. O Express serve para
linha de comando e manutenção. GitHub Pages não roda Node, e uma página HTTPS não
chama `http://localhost` — por isso a leitura do boleto acontece no navegador.

---

## Guias

| Arquivo | Assunto |
|---|---|
| [`docs/01-COMO-RODAR.md`](docs/01-COMO-RODAR.md) | Os comandos, do zero |
| [`docs/02-SUPABASE-SETUP.md`](docs/02-SUPABASE-SETUP.md) | Criar o banco grátis, passo a passo |
| [`docs/03-DEPLOY-GITHUB-PAGES.md`](docs/03-DEPLOY-GITHUB-PAGES.md) | Publicar |
| [`docs/04-API.md`](docs/04-API.md) | As rotas do back-end e as funções do banco |
| [`docs/05-ARQUITETURA.md`](docs/05-ARQUITETURA.md) | Como as peças se encaixam |
| [`docs/06-COMO-ENVIAR-O-EXCEL.md`](docs/06-COMO-ENVIAR-O-EXCEL.md) | Importar o Mapeamento Geral de Contas |
| [`docs/07-ACESSO-E-PAPEIS.md`](docs/07-ACESSO-E-PAPEIS.md) | Login, primeiro acesso, domínios e escopos NF/MD |
| [`docs/08-EMAIL-DE-VERDADE.md`](docs/08-EMAIL-DE-VERDADE.md) | Fazer o e-mail de ativação realmente chegar (SMTP, modelos) |

---

## Testes

```bash
cd backend
npm install
npm test
```

40 testes cobrindo a matemática do boleto: conversões nos dois sentidos,
detecção de dígito adulterado, as datas de vencimento (incluindo a virada do
contador FEBRABAN em fevereiro de 2025) e entradas inválidas.

---

## Licença

Uso interno da Serena Energia.
