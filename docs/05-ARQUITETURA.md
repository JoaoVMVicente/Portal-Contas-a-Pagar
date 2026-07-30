# 05 — Arquitetura

Como as peças se encaixam, e por que estão arrumadas assim.

---

## O desenho

```
┌───────────────────────────────────────────────────────────────┐
│  NAVEGADOR                                                     │
│                                                                │
│  index.html   login.html   cliente.html   operador.html        │
│      │            │             │              │               │
│  pagina-inicio  pagina-login  pagina-cliente  pagina-operador  │
│      └────────────┴──────┬──────┴──────────────┘               │
│                          │                                      │
│         ┌────────────────┼────────────────┐                    │
│         │                │                │                     │
│    sessao.js         dados.js         ui.js                    │
│    layout.js             │            contas.js                │
│                          │            extrator.js              │
│              ┌───────────┴──────────┐  boleto-parser.js        │
│              │                      │  boleto-campos.js        │
│              │                      │                           │
│      dados-demo.js          dados-supabase.js                  │
│      (localStorage)                 │                           │
└─────────────────────────────────────┼───────────────────────────┘
                                      │ HTTPS
                                      ▼
┌───────────────────────────────────────────────────────────────┐
│  SUPABASE                                                      │
│                                                                │
│   Auth ──────────► cria usuário ──┐                            │
│                                    │ gatilho                    │
│   Postgres ◄───────────────────────┘                            │
│     tabelas · funções · visões · RLS                           │
│                                                                │
│   Storage (balde privado "boletos")                            │
│   Realtime (avisa quando boletos muda)                         │
└───────────────────────────────────────────────────────────────┘
                                      ▲
                                      │ opcional
┌─────────────────────────────────────┴─────────────────────────┐
│  BACK-END EXPRESS — roda na sua máquina                        │
│  extração por linha de comando · recarga de unidades           │
└───────────────────────────────────────────────────────────────┘
```

---

## As camadas do front-end, de baixo para cima

### `boleto-parser.js` — a camada que não conhece o mundo

Matemática pura. Não sabe o que é HTML, não sabe o que é banco de dados, não faz
chamada de rede. Recebe texto ou dígitos e devolve valor, vencimento e validação.

É por isso que ela é **a única parte com testes automáticos**: funções puras são
fáceis de testar e é onde um erro sai mais caro. E é por isso que o back-end
**importa exatamente este arquivo** em vez de ter a própria cópia — duas cópias
sempre acabam divergindo.

### `extrator.js` — a camada que abre arquivos

Sabe abrir PDF e imagem, sabe pedir texto, sabe chamar o OCR. Usa o parser para
interpretar. Não sabe nada de banco.

### `dados.js` + os dois drivers — a camada que guarda

Aqui está uma decisão que vale explicar. Existem dois arquivos com **exatamente
os mesmos métodos**:

- `dados-demo.js` guarda tudo no navegador (localStorage)
- `dados-supabase.js` guarda no banco real

O `dados.js` olha se há chaves configuradas e escolhe um dos dois. As telas
importam só `dados.js` e **nunca sabem qual está ativo**.

Ganhos disso:

1. O portal funciona **antes** de existir banco. Você abre e vê.
2. Trocar de banco no futuro significa escrever um terceiro driver, sem tocar em
   nenhuma tela.
3. Testar a interface não exige internet.

O custo: os dois arquivos precisam ter os mesmos métodos. Se um ganhar um método
novo e o outro não, o modo demonstração quebra naquele ponto.

### `sessao.js` — a camada que sabe quem você é

Guarda **duas** coisas diferentes, e a diferença é o coração do requisito de
"admin vê as duas telas":

| Conceito | Onde vive | O que é |
|---|---|---|
| **Papel** | No banco, na tabela `profiles` | `admin` ou `cliente`. Verdade. Não muda por vontade da pessoa. |
| **Escopo** | No banco, na tabela `profiles` | `NF`, `MD` ou `ambos`. Qual tipo de documento a pessoa trabalha. Verdade. |
| **Visão** | No navegador (localStorage) | Qual tela ela está olhando agora. Preferência. |
| **Tipo ativo** | No navegador (localStorage) | Qual das duas filas está aberta. Só existe para escopo `ambos`. |

Um operador tem papel `admin` e pode ter visão `cliente` — está usando o
formulário como qualquer solicitante. Um solicitante tem papel `cliente` e
**nunca** consegue visão `operador`: se digitar `/operador.html` na barra de
endereço, o `exigirLogin({ exigirOperador: true })` manda embora — e mesmo que
não mandasse, o RLS não devolveria nenhuma linha dos outros.

Duas trancas para a mesma porta, de propósito. A primeira é educada (mostra um
aviso), a segunda é intransponível.

### `boleto-campos.js` — o palpite educado, separado da matemática

Fiz questão de manter isto num arquivo próprio, longe do `boleto-parser.js`.
O parser faz **matemática**: calcula valor e vencimento e confere pelo dígito
verificador — certo ou errado, sem meio-termo. Este arquivo faz **palpite
educado**: procura rótulos no texto para achar o número do documento, os CNPJs e
o nome do fornecedor. Não existe dígito verificador para "nome do fornecedor".

Misturar os dois no mesmo arquivo daria a impressão de que têm a mesma
confiabilidade. Não têm — e cada coisa que sai daqui vem com um nível de
confiança que a tela mostra.

A exceção feliz é o CNPJ da nossa empresa: como temos a lista das 213 empresas,
basta conferir qual dos CNPJs do boleto está nela. Isso é quase tão confiável
quanto a matemática.

### `ui.js`, `layout.js`, `contas.js` — as ferramentas

Ícones, formatação, avisos flutuantes, janelas, o topo com o alternador de visão
e o seletor NF/MD, e as 213 empresas com suas 1.127 contas — incluindo a busca
que entende algarismos romanos.

### `pagina-*.js` — as telas

Uma por página. Só estas conhecem HTML. Só estas leem `document`.

---

## Por que o RLS no banco em vez de checagem no JavaScript

Esta é **a** decisão de segurança do projeto, então vale ser explícito.

JavaScript no navegador está **na máquina da outra pessoa**. Ela pode abrir o
console e chamar o que quiser. Toda checagem que existe apenas no front-end é
uma sugestão, não uma regra.

Então as regras estão no Postgres, com RLS. O que acontece se alguém tentar
burlar:

| Tentativa | Resultado |
|---|---|
| Abrir o console e pedir todos os boletos | Volta só os dela. As outras linhas não existem para aquela conexão. |
| Trocar o próprio papel para `admin` | A política de UPDATE em `profiles` não permite mexer no campo `papel`. |
| Criar boleto já com status `associado` | A política de INSERT exige `pendente`. |
| Inventar um par empresa + conta | O gatilho confere contra `contas_bancarias`. Não existe, não entra. |
| Pedir medições sendo do time de NF | A política de leitura filtra pelo escopo. Volta lista vazia. |
| Associar um boleto fora do escopo | A função recusa com `FORA_DO_ESCOPO`. |
| Criar senha para o e-mail de um colega | O link de ativação vai para a caixa dele, não para a sua. |
| Apagar um boleto | Não existe política de DELETE. Ninguém apaga. |
| Baixar o arquivo de outra pessoa | O caminho começa com o id do dono; o Storage confere. |
| Chamar `associar_boleto` sendo solicitante | A função checa `eh_admin()` e recusa. |

O front-end continua checando as mesmas coisas — mas por **educação**, para dar
mensagem clara em vez de erro cru. Se as duas discordarem, quem manda é o banco.

---

## O caminho de um boleto, do início ao fim

1. O solicitante anexa o arquivo.
2. `extrator.js` abre o PDF, pega o texto, agrupa por linha.
3. `boleto-parser.js` acha a linha digitável, confere o dígito, **calcula** valor
   e vencimento.
4. A tela preenche os campos e mostra o nível de confiança.
5. A pessoa completa o resto e envia.
6. `dados-supabase.js` sobe o arquivo para o Storage.
7. Insere a linha em `boletos`. O RLS confere tudo.
8. Um gatilho grava o evento "criado" em `boleto_eventos`.
9. O Realtime avisa todo mundo que está com o painel aberto.
10. O painel do operador recarrega os cartões e a tabela. **Cerca de um segundo.**
11. O operador clica em associar. A função `associar_boleto` grava quem, quando,
    e registra outro evento.
12. O Realtime avisa de novo. O cartão de pendentes cai, o de associados sobe.
13. O solicitante vê "Associado" na lista dele.

---

## Por que sem framework e sem build

Não é preferência estética. É consequência de dois requisitos que você deu:

**"Vai rodar no GitHub Pages."** O Pages não roda build. Com framework, seria
preciso um passo de compilação e um jeito de publicar o resultado — mais peças,
mais coisa para quebrar, e um lugar onde o código publicado difere do código do
repositório.

**"Vai rodar local também."** Sem build, rodar local é servir a pasta. Um
comando. Nada de instalar dependências para ver uma tela.

O que se perde: React e Vue trazem coisas úteis quando o projeto cresce. Se este
portal virar dez telas com estado compartilhado, valerá reconsiderar. Com quatro
telas, o custo do framework é maior que o ganho.

O que **não** se perde: os módulos ES (`import`/`export`) dão organização de
verdade. Cada arquivo declara do que depende. Não existe variável global
escondida.

---

## O que quebraria primeiro se o uso crescer muito

Sendo honesto sobre os limites:

| Limite | Quando aparece | Como resolver |
|---|---|---|
| Projeto grátis pausa após 7 dias sem uso | Se o portal ficar parado | Um clique em "Restore". Ou plano pago. |
| 1 GB de arquivos | Uns 10 mil boletos | Plano pago, ou mover PDFs antigos para outro lugar |
| 3 e-mails por hora | Cadastrando muita gente de uma vez | Ligar SMTP próprio da Serena |
| Tabela sem paginação no CSV | Exportar mais de ~5 mil linhas de uma vez | Exportar por período |
| OCR no navegador é lento | Muitos boletos escaneados | Usar o back-end para processar em lote |

Nada disso é problema no tamanho de uso previsto. Está aqui para você saber onde
olhar quando e se aparecer.
