# PRD — Portal de Associação de Boletos da Serena

> **PRD** quer dizer *Product Requirements Document*: o documento que explica
> **o que** o sistema faz, **por que** ele faz assim e **como** cada pedaço se
> encaixa. Escrevi tudo com palavras simples, de propósito. Se uma parte parecer
> óbvia demais, ótimo — é assim que deve ser.

---

## 0. O que mudou na versão 2

Cinco mudanças, depois de ver o portal rodando e de abrir a planilha de contas.
Registro aqui o que mudou **e por quê**, porque duas delas contrariam o pedido
original — e o motivo importa mais que a mudança.

### 0.1 O login virou a primeira tela

Antes o portal mostrava os cartões de serviço para visitante, com um botão
"Entrar" no canto. Agora quem não está logado vai direto para o login.
O portal é todo interno: não existe nada aqui para quem não entrou, então
mostrar a vitrine antes da porta só somava um clique.

### 0.2 O primeiro acesso não define a senha na tela — ele manda um link

**Isto contraria o pedido, de propósito.** O pedido era: ao tentar entrar,
aparecer um botão "Primeiro acesso" com o e-mail identificado, um campo de senha
e um botão de entrar.

A metade visual está exatamente assim. A segunda metade mudou, porque o próprio
risco que motivou o pedido continuaria de pé: *"eu poderia criar uma senha para
todo mundo do meu time sem eles saberem"*. Se a senha fosse definida ali na tela,
bastaria digitar o e-mail do colega — o problema seria idêntico.

O que impede é exigir uma prova de que a caixa de e-mail é sua. E a única prova
que existe é **abrir o link enviado para ela**. Então: primeiro acesso manda o
link, a pessoa abre, e só aí escolhe a senha. Duas telas em vez de uma, e o
problema deixa de existir.

Detalhe relacionado: o botão aparece depois de **qualquer** tentativa que não deu
certo, não só para e-mails pré-cadastrados. Se aparecesse só para eles, a tela
viraria uma lista de quem trabalha aqui — bastaria testar e-mails e ver onde o
botão surge.

E a aba "Criar conta" foi removida: fazia o mesmo que o primeiro acesso, com
dois caminhos para manter e dois lugares para errar.

### 0.3 Dois domínios, não um

`@srna.co` e `@ext.srna.co`. Terceirizados entram e podem ser operadores como
qualquer outro. A tela mostra um "· externo" discreto ao lado do nome — para a
operação saber com quem fala, não para restringir nada.

A lista de domínios está em **um** lugar na tela e **um** no banco. Um terceiro
domínio, no futuro, é mexer em dois pontos.

### 0.4 Cada operador vê só o tipo de documento que trabalha

Nova coluna: **escopo**, que vale `NF`, `MD` ou `ambos`.

| Quem | Escopo |
|---|---|
| João Vicente e Pedro Moreira | `ambos` |
| Thaís Lima e Karoline Lima | `MD` |
| Restante da equipe | `NF` |

A tela é a mesma para os dois tipos; o que muda é o conteúdo. Quem tem escopo
fixo não vê alternador nenhum — vê um selo dizendo o que trabalha, e a fila já
vem filtrada. Quem tem `ambos` ganha um alternador no topo, com o número de
pendentes de cada lado.

Não fiz duas páginas separadas por três motivos: duas cópias do mesmo layout
viram duas manutenções; quem só vê NF não precisa nem saber que MD existe; e
quem vê as duas descobre que tem medição esperando sem trocar de tela.

E o filtro **não é só visual**: está no RLS do Postgres. Quem tem escopo `NF`
recebe lista vazia se pedir medições, mesmo mandando o comando pelo console.

### 0.5 O formulário virou um assistente, uma etapa por vez

As sete seções apareciam todas juntas. Um formulário longo assusta: a pessoa bate
o olho, vê vinte campos e desanima antes de começar.

Agora só a etapa atual fica aberta. As anteriores viram uma linha resumida com
botão "Editar"; as seguintes ficam acinzentadas — visíveis, para dar a noção do
tamanho da tarefa, mas fechadas. Uma trilha no topo mostra onde a pessoa está.

O ganho real aparece na prática: como o arquivo é a **primeira** etapa, quando a
pessoa chega nas etapas 3, 4, 5 e 6 elas já estão preenchidas pela leitura do
boleto. O trabalho vira conferir, não digitar.

### 0.6 A leitura do boleto agora preenche muito mais

Além de valor, vencimento e código de barras, o sistema tira do arquivo:

- **número do documento** (etapa 3)
- **CNPJ da nossa empresa** → identifica a unidade de negócio (etapa 4)
- **razão social e CNPJ do fornecedor** (etapa 5)

O truque para separar "nosso CNPJ" de "CNPJ do fornecedor" está na seção 4.7.

E o campo **motivo da exceção** saiu da etapa 7, conforme pedido.

### 0.7 O "CC" mudou de significado

Ao abrir o Mapeamento Geral de Contas, a coluna I ("CONTA") mostrou ser a
**conta bancária**, não um código de centro de custo. Isso inverteu a relação
entre os dados. Está explicado na seção 5, que foi reescrita.

---

## 1. A história do problema

Imagine uma escola muito grande. Todo dia, dezenas de professores levam contas
para a secretaria pagar: a conta da papelaria, a do ônibus da excursão, a do
lanche. Cada conta vem num papelzinho diferente, com o nome do professor escrito
de qualquer jeito, e às vezes falta a informação mais importante de todas: **de
qual turma esse gasto é?**

A secretaria então precisa fazer um trabalho chato: pegar cada papelzinho,
descobrir de qual turma é, conferir o valor, conferir a data, e só então mandar
pagar. Esse trabalho de "descobrir a qual coisa esse papel pertence" é o que
chamamos de **associação**.

Na Serena, a mesma coisa acontece, só que em vez de turmas existem **unidades de
negócio** (os parques eólicos, as usinas solares, as PCHs, as empresas do grupo),
e em vez de papelzinhos existem **boletos** de fornecedores.

**O problema:** hoje esses boletos chegam espalhados — em e-mails, em mensagens,
em anexos soltos. Alguém precisa juntar tudo à mão, digitar valores olhando o
papel (e às vezes digitar errado), e não existe um lugar único onde dá para ver
"quantos boletos estão esperando?" ou "quanto dinheiro tem nessa fila?".

**O que este portal faz:** cria esse lugar único. Uma porta de entrada para quem
envia, um painel para quem processa, e um computador fazendo a parte chata de ler
os números.

---

## 2. As duas pessoas que usam o sistema

Existem exatamente dois tipos de gente aqui. Nada de meio-termo.

### 2.1 O **solicitante** (a que chamamos de "cliente")

É quem tem um boleto na mão e precisa que ele seja pago.

O que ela quer: mandar o boleto e **parar de se preocupar**. Não quer preencher
vinte campos, não quer digitar um número de 47 dígitos, não quer descobrir se
digitou certo.

O que ela vê: um formulário e uma lista com os boletos que ela mesma mandou.

O que ela **não** vê: os boletos de outras pessoas. Nunca.

### 2.2 O **operador** (a equipe de operação)

É quem recebe a fila e faz a associação acontecer.

O que ela quer: ver tudo em uma tela só, saber o que é urgente, e conseguir
resolver um boleto em dois cliques.

O que ela vê: **todos** os boletos, de todo mundo, com quatro números grandes no
topo resumindo a situação.

Um operador também pode virar solicitante quando quiser — porque ele também tem
boletos para mandar. Tem um botão no alto da tela que troca de lado. Um
solicitante comum **não tem** esse botão, porque não existe nada para ele trocar.

---

## 3. As telas, uma por uma

### 3.1 Tela inicial (`index.html`)

Uma tela calma, com cartões. Cada cartão é um serviço. Hoje existe um cartão
funcionando: **Associação de Boletos**. Os outros dois estão desenhados e
marcados como "Em breve", só para o portal já nascer com cara de portal.

Quando alguém clica no cartão de boletos, acontece uma pergunta em três partes:

1. **A pessoa está logada?** Se não, ela vai para a tela de entrar. E o sistema
   guarda na memória para onde ela queria ir, para levá-la lá depois de entrar.
2. **É solicitante comum?** Então vai direto para o formulário. Só existe um
   caminho para ela.
3. **É operador?** Aí aparece uma janelinha com duas portas: "visão do operador"
   ou "visão do cliente". Ela escolhe.

### 3.2 Tela de entrar (`login.html`)

Faz quatro coisas:

- **Entrar** com e-mail e senha.
- **Criar conta** — pede nome, sobrenome, e-mail e senha.
- **Confirmar o e-mail.** Ao criar a conta, chega um e-mail com um link. Enquanto
  a pessoa não clicar nesse link, ela não entra. Isso existe porque qualquer um
  poderia digitar o e-mail de outra pessoa; o link prova que o e-mail é dela.
- **Esqueci minha senha** — manda um link para escolher uma nova.

Só aceita e-mail terminando em **@srna.co**. Alguém de fora simplesmente não
consegue criar conta.

### 3.3 Tela do solicitante (`cliente.html`)

Um formulário dividido em sete pedaços, na ordem que faz sentido para quem está
preenchendo:

| Pedaço | O que pede | Por que essa ordem |
|---|---|---|
| 1. O boleto | O arquivo | **Vem primeiro de propósito.** Ao anexar, o sistema lê o arquivo e já preenche valor, vencimento e código de barras. Se pedíssemos isso no fim, a pessoa teria digitado tudo à mão sem precisar. |
| 2. Quem solicita | Nome, sobrenome, e-mail | Nome e sobrenome são dois campos aqui, mas na tela do operador aparecem juntos numa coluna só. O e-mail já vem preenchido e travado — é o da conta. |
| 3. O documento | NF ou MD, número, "está regularizado?" | A pergunta muda de texto sozinha: se escolher NF, pergunta sobre escrituração; se escolher MD, pergunta sobre aprovação. |
| 4. Unidade de negócio | Código de conta (CC) e a empresa | Os dois campos conversam. Explico abaixo. |
| 5. Fornecedor | Razão social e CNPJ | O CNPJ é conferido pela conta de verificação. |
| 6. Valor, vencimento, código | Já preenchidos pela leitura | A pessoa só confere. |
| 7. Classificação | Departamento e motivo | Ajuda a operação a priorizar. |

Embaixo do formulário, a lista **"Meus boletos"**, com a situação de cada um.
Se um boleto foi recusado, aparece um ícone que mostra exatamente o que precisa
ser corrigido.

### 3.4 Tela do operador (`operador.html`)

No topo, **quatro cartões grandes**:

- **Total de boletos** — quantos existem.
- **Valor total** — a soma de todos os valores.
- **Pendentes** — quantos ainda esperam alguém.
- **Associados** — quantos já foram resolvidos.

Esses quatro números **se atualizam sozinhos**. Se um solicitante mandar um
boleto agora, o número muda na tela do operador em cerca de um segundo, sem
ninguém apertar nada — e o cartão dá uma pulsadinha para o olho perceber a
mudança. O título da aba do navegador também mostra quantos estão pendentes, para
dar para ver mesmo com a aba no fundo.

Embaixo, a tabela, com uma coluna para cada informação:

| Coluna | O que mostra | Detalhe |
|---|---|---|
| **Boleto** | Um clipe de papel | Clicar baixa o arquivo. O link nasce na hora e vale 5 minutos. |
| **NF/MD** | `NF-8821` ou `MD-4432` | Se o solicitante marcou "não regularizado", aparece um alerta embaixo. |
| **Data** | Quando o boleto entrou no portal | Não é o vencimento. É a data de chegada, marcada pelo servidor. |
| **Nome** | Nome e sobrenome, juntos | Com o e-mail embaixo, em letra menor. |
| **CC** | O código de conta | |
| **Und. neg / CNPJ** | A empresa e o CNPJ dela | |
| **Fornecedor / CNPJ** | Quem emitiu o boleto | |
| **Valor** | Em reais | Se o número não veio conferido pela matemática, ganha uma etiqueta "conferir". |
| **Vencimento** | A data | Ganha uma etiqueta vermelha se já venceu, ou laranja se vence em poucos dias. |
| **Cód Barras** | Um ícone de código de barras | Clicar **copia** o número, pronto para colar no banco. |
| **Data associação** | Quando foi resolvido | Vazio enquanto está pendente. |
| **Executado por** | Quem resolveu | Enquanto ninguém resolveu, mostra a situação. |
| **Ações** | Associar, ver detalhes, recusar | |

Tem busca (procura em nome, fornecedor, CNPJ, CC, número e código de barras),
abas por situação, filtro por CC, ordenação clicando no cabeçalho, e um botão que
exporta tudo em CSV que abre bonito no Excel brasileiro.

---

## 4. A parte mais interessante: como o sistema lê o boleto

Aqui está a ideia que muda tudo, e vou explicar com calma porque foi a decisão
técnica mais importante do projeto.

### 4.1 O que me pediram

Foi mencionada uma prática chamada **"ORC"**. O nome certo é **OCR** —
*Optical Character Recognition*, ou "reconhecimento óptico de caracteres". É a
tecnologia que olha uma imagem e tenta adivinhar quais letras e números estão
desenhados ali.

### 4.2 Por que OCR **não** é a melhor ferramenta aqui

OCR é um **chute educado**. Ele olha o desenho e opina: "isso parece um 8".
Mas 8 e 3 são parecidos. 1 e 7 são parecidos. 0 e O são quase iguais. Numa
folha amassada, escaneada torta, com o carimbo em cima do número, o OCR erra.

E errar aqui é caro: um dígito errado no valor transforma R$ 980,50 em
R$ 930,50, ou pior, R$ 9.980,50.

### 4.3 O que descobri: o boleto **carrega** a resposta

Todo boleto brasileiro segue uma regra chamada padrão **FEBRABAN**. E essa regra
determina que aquele número comprido embaixo do código de barras — a **linha
digitável**, com 47 dígitos — não é um número qualquer. Ele é uma **caixinha
organizada**, onde cada pedaço significa uma coisa:

```
00190 5009 4014481606 9068093503 1 43337 0000000100
└─┬─┘ └┬─┘ └───────┬────────────┘ │ └─┬─┘ └────┬───┘
  │    │           │              │   │        │
  │    │           │              │   │        └─ o VALOR, em centavos
  │    │           │              │   └────────── o VENCIMENTO, codificado
  │    │           │              └────────────── o dígito que confere tudo
  │    │           └───────────────────────────── dados do banco
  │    └───────────────────────────────────────── moeda (9 = real)
  └────────────────────────────────────────────── qual banco (001 = BB)
```

Ou seja: **o valor e o vencimento estão escritos ali, em código.** Não preciso
adivinhar olhando o desenho. Eu **calculo**.

E tem mais: aquele dígito solitário no meio é um **dígito verificador**. Ele é o
resultado de uma conta feita com todos os outros dígitos. Se eu ler o número e a
conta fechar, o número está certo — não "provavelmente certo", **certo**. Se um
único dígito estiver errado, a conta não fecha e o sistema avisa.

É como um cadeado que só abre com a senha exata.

### 4.4 A ordem de tentativas

Então o sistema tenta, na ordem, do mais confiável para o menos:

**Nível 1 — O texto de dentro do PDF.**
A maioria dos boletos é PDF gerado por computador, e tem o texto lá dentro, de
verdade. Basta pedir. Nenhum chute envolvido.

**Nível 2 — Achar a linha digitável e fazer a conta.**
Com o texto na mão, procuro os 47 dígitos, confiro o dígito verificador, e
calculo o valor e o vencimento. Se o cadeado abre: **confiança alta**.

**Nível 3 — Só aí, o OCR.**
Se o PDF era uma foto (um scan, sem texto dentro), transformo a página em imagem
e uso OCR. Mas com um detalhe esperto: mesmo que o OCR erre, se ele acertar os
47 dígitos, o **dígito verificador me avisa**. Ou seja: uso o OCR para *tentar*
ler, e a matemática para *conferir* se ele leu certo.

**Nível 4 — A pessoa digita.**
Se nada funcionou, os campos ficam abertos. E há um campo onde a pessoa pode
colar a linha digitável; ao colar, o valor e o vencimento se recalculam na hora.

Em todos os casos, o sistema mostra **de onde** cada número veio e **quanta
confiança** tem nele. O operador nunca fica no escuro.

### 4.5 A ideia mais útil da leitura de texto

Valor e vencimento saem da matemática do código de barras. Mas o número do
documento, o CNPJ da nossa empresa e os dados do fornecedor estão no **texto**,
e texto não tem dígito verificador. Como confiar?

Para um deles, tem um jeito muito bom.

Um boleto carrega **dois** CNPJs: o do beneficiário (o fornecedor, quem recebe) e
o do pagador (a nossa empresa, quem paga). Descobrir qual é qual lendo os rótulos
é frágil, porque cada banco escreve diferente — "Beneficiário", "Cedente",
"Favorecido" — e o OCR pode ler a palavra errada.

Só que nós **temos a lista das 213 empresas do grupo**. Então:

```
CNPJ que ESTÁ na nossa lista   ->  é a nossa empresa (o pagador)
CNPJ que NÃO está na lista     ->  é o fornecedor
```

Isso não depende de rótulo, nem de layout, nem de o OCR acertar uma palavra.
Depende só de conferir uma lista. É de longe a parte mais confiável da leitura de
texto — quase no nível da matemática.

E tem um efeito colateral bom: a empresa identificada assim já vem com o CNPJ
que existe na planilha, então o par empresa + conta nunca sai inválido.

Para o **número do documento** não existe truque equivalente, então o sistema
junta candidatos, dá peso a cada um e mostra o mais provável — com uma armadilha
específica evitada: "Nosso número" **não** é o número da nota, é o identificador
que o banco dá ao boleto. Confundir os dois é o erro clássico aqui, e ele está na
lista de rótulos a ignorar. Quando há mais de um candidato, a tela mostra fichas
clicáveis em vez de obrigar a apagar e digitar.

Para o **CNPJ do fornecedor**, se o dígito verificador não fechar, o número é
mostrado assim mesmo — com um selo laranja dizendo "confira os dígitos". Um OCR
que troca um número é comum, e é bem mais fácil corrigir um dígito do que digitar
os catorze.

### 4.5 Dois detalhes que quase estragaram tudo

Precisei depurar duas armadilhas que valem registro:

**Armadilha 1: a data de referência.** O vencimento não está no boleto como
"12/07/2026". Está como um número: quantos dias passaram desde uma data-base. A
documentação que se acha por aí diz coisas confusas sobre essa data. Testando
contra boletos reais, confirmei: a base é **07/10/1997**, e o fator começa em
**zero**, não em 1000 como muitos tutoriais afirmam.

**Armadilha 2: o contador dá a volta.** Esse número só vai até 9999. E ele
**estourou** — o fator 9999 correspondeu a 21/02/2025, e a partir de 22/02/2025 a
FEBRABAN reiniciou a contagem em 1000. Sem tratar isso, um boleto de hoje seria
lido como se vencesse em 2001. O sistema testa as duas possibilidades, escolhe a
que faz sentido (uma janela razoável em volta de hoje) e, se as duas fizerem
sentido, avisa que a data está ambígua em vez de escolher escondido.

### 4.6 Como sei que funciona

Escrevi **40 testes automáticos**. Eles verificam a conversão nos dois sentidos
contra um par oficial conhecido, confirmam que trocar um dígito qualquer faz a
validação falhar, checam as datas contra âncoras conhecidas, e testam entradas
malucas (texto vazio, letras, número gigante) para garantir que nada quebra.

Rodar os testes: `cd backend && npm test`. Os 40 passam.

---

## 5. As empresas e as contas bancárias

### 5.1 A premissa que a planilha derrubou

No começo eu supus que "CC" fosse um código de centro de custo, que agrupasse
empresas. Ao abrir o `Mapeamento Geral de Contas`, a coluna I ("CONTA") mostrou
ser a **conta bancária** da empresa. E uma empresa tem várias — a maior do grupo
tem **31**.

Isso inverte a relação:

```
ANTES (errado):   1 código de conta  ->  N empresas
AGORA (certo):    1 empresa          ->  N contas bancárias
```

Números da sua planilha: **213 empresas**, **1.127 contas** (1.073 ativas,
54 encerradas).

### 5.2 Como isso muda o formulário

O caminho principal ficou melhor do que era:

1. O boleto traz o CNPJ da nossa empresa.
2. O sistema identifica a empresa cruzando com a planilha (seção 4.5).
3. A pessoa escolhe **qual conta** daquela empresa.

Quando a empresa tem uma conta só, ela já vem selecionada. Quando tem 31, o
seletor mostra banco, agência e tipo junto do número — porque o número sozinho
não distingue nada:

```
000577081425-6 · CAIXA ECONÔMICA · ag. 1482 / 1292 · CONTA CENTRALIZADORA
```

O caminho inverso também funciona: digitar o número da conta identifica a
empresa, porque conta praticamente não se repete (uma única se repete em duas
empresas, e o importador avisa).

### 5.3 Três detalhes da planilha que precisaram de cuidado

**Algarismos romanos.** 107 das 233 razões sociais usam romanos:
`ASSURUÁ 2 IV ENERGIA S.A.`, `DELTA 7 I`. Quem digita escreve "delta 7 1". A
solução foi guardar, junto de cada empresa, uma chave de busca em que os romanos
soltos viram números árabes, os acentos saem e o "S.A." é descartado:

```
"ASSURUÁ 2 IV ENERGIA S.A."  ->  "ASSURUA 2 4 ENERGIA"
"assurua 2 4"                ->  "ASSURUA 2 4"
```

Os dois lados passam pela mesma normalização, então encontram a mesma empresa.
Funciona nos dois sentidos.

**A conta vem com traço** (`37700-7`). Guardamos as duas formas: a original,
para exibir igual à planilha, e só os dígitos, para procurar.

**54 contas estão encerradas.** Entram no arquivo com `ativa: false` e não
aparecem no formulário. Ficam para o histórico dos boletos antigos continuar
legível.

### 5.4 Duas coisas que eu não esperava encontrar

**Sete empresas dos Estados Unidos** (as `LLC` do grupo Goodnight) têm **EIN de
9 dígitos**, não CNPJ de 14. Seriam rejeitadas como "CNPJ inválido", o que
estaria errado — o documento está certo, só não é brasileiro. Ficam marcadas
como `ein` e a tela mostra "EIN 123456789" em vez de tentar formatar como CNPJ.

**Seis CNPJs aparecem com mais de um nome** — casos de renomeação, que as abas
`MUDANÇA DE DENOMINAÇÕES` da planilha confirmam. O nome mais longo vira o
principal, o outro fica como apelido, e a busca acha pelos dois.

### 5.5 JSON e tabela: por que os dois

- O **JSON** (`frontend/data/contas-bancarias.json`) é velocidade de tela.
  Carrega uma vez, com os cruzamentos já prontos, e a busca é instantânea.
- A **tabela no banco** é autoridade. Quando um boleto é gravado, um gatilho
  confere se aquele par empresa + conta existe e está ativo — e preenche o nome
  da empresa, o banco e o tipo da conta a partir da fonte da verdade, em vez de
  confiar no que veio da tela.

Se alguém tentar mandar uma combinação inventada, mesmo mexendo no JavaScript, o
banco recusa com `CONTA_INVALIDA`.

Como importar está em `docs/06-COMO-ENVIAR-O-EXCEL.md`.

## 6. O banco de dados

### 6.1 A metáfora do armário

Pense num armário de fichas na secretaria da escola. Cada gaveta é uma tabela:

| Gaveta (tabela) | O que guarda |
|---|---|
| `profiles` | Uma ficha por pessoa: nome, e-mail e se é operador ou solicitante |
| `admin_emails` | A lista de e-mails que viram operador automaticamente |
| `empresas` | As 213 empresas do grupo (razão social + CNPJ) |
| `contas_bancarias` | As 1.127 contas de cada empresa — o "CC" do portal |
| `departamentos` | A lista de departamentos |
| `boletos` | O coração: uma ficha por boleto |
| `boleto_eventos` | O diário: tudo que já aconteceu com cada boleto |

### 6.2 A tranca que importa: RLS

**RLS** significa *Row Level Security* — "segurança por linha". É a parte mais
importante da segurança inteira, então vale explicar bem.

Numa escola sem tranca, o armário fica aberto e todos confiam que ninguém vai
mexer na ficha dos outros. Numa escola com RLS, o armário tem uma tranca mágica:
**quando você abre a gaveta, só existem lá dentro as fichas que você tem direito
de ver.** As outras simplesmente não estão ali para você.

Isso está configurado assim:

- Um **solicitante** que abrir a gaveta de boletos encontra só os dele.
- Um **operador** encontra todos.
- Ninguém pode **apagar** um boleto. Boleto errado é *recusado*, não deletado —
  o histórico fica.
- Um boleto novo entra sempre como **pendente**. Não dá para criar um boleto já
  associado.
- O par empresa + conta **precisa existir** e estar ativo.
- Um operador só lê boletos do **tipo que ele trabalha** (NF, MD ou os dois).
- Um solicitante **não consegue se promover** a operador mexendo na própria ficha.

**Por que isso é tão importante?** Porque a regra está no **banco**, não na tela.
JavaScript é um cartaz na parede da secretaria: qualquer um pode arrancar. RLS é
a tranca do armário. Mesmo que alguém abra o console do navegador e mande
comandos direto, a tranca continua fechada. Não existe caminho por fora.

### 6.3 Os arquivos do banco, em ordem

| Arquivo | O que faz |
|---|---|
| `db/01_schema.sql` | Cria as gavetas |
| `db/02_functions_triggers.sql` | As automações (criar perfil, marcar admin, os 4 números, associar, recusar) |
| `db/03_views.sql` | A "janelinha" que já entrega a tabela do operador pronta |
| `db/04_rls.sql` | **As trancas** |
| `db/05_storage.sql` | O depósito dos arquivos, privado |
| `db/06_seed_admins.sql` | Cadastra os 17 e-mails da equipe, com o escopo de cada um |
| `db/07_seed_contas.sql` | Carrega as empresas e contas (o importador gera este) |
| `db/08_realtime.sql` | Liga o "avisa quando mudar" dos quatro cartões |

Rode **na ordem numérica**. Cada um depende do anterior.

### 6.4 Como um operador nasce operador

1. Os e-mails da equipe ficam guardados em `admin_emails` (arquivo `06`), cada
   um com o seu **escopo**: `NF`, `MD` ou `ambos`.
2. Quando a pessoa **ativa** a conta, o banco cria a ficha dela e confere: "esse
   e-mail está na lista?"
3. Se estiver, a ficha nasce com papel **admin** e o escopo da lista. Se não,
   nasce **cliente**.

Ninguém precisa promover ninguém à mão. E se alguém entrar, sair ou trocar de
escopo, basta mexer em `admin_emails` — os perfis se ajustam na hora, porque tem
uma automação vigiando essa tabela.

Importante: estar em `admin_emails` **não cria conta e não dá acesso sozinho**.
A pessoa ainda precisa ativar a conta pelo link que chega no e-mail dela. Ver
`docs/07-ACESSO-E-PAPEIS.md`.

---

## 7. As peças do sistema e como conversam

```
   ┌─────────────────────────────────────────────────────────┐
   │  NAVEGADOR (o front-end, em HTML/CSS/JavaScript)        │
   │                                                          │
   │  index    login    cliente    operador                   │
   │     │        │         │          │                      │
   │     └────────┴────┬────┴──────────┘                      │
   │                   │                                       │
   │            ┌──────┴──────┐                               │
   │            │  dados.js   │  ← escolhe com quem falar     │
   │            └──┬───────┬──┘                               │
   │               │       │                                   │
   │      demo ────┘       └──── Supabase                     │
   │   (localStorage)                │                         │
   │                                 │                         │
   │  boleto-parser.js  ← a matemática do boleto              │
   │  extrator.js       ← lê o PDF aqui mesmo                 │
   └─────────────────────────────────┼─────────────────────────┘
                                     │ HTTPS
                                     ▼
   ┌─────────────────────────────────────────────────────────┐
   │  SUPABASE (na nuvem, plano grátis)                       │
   │                                                          │
   │  Auth: e-mail e senha + confirmação                      │
   │  Postgres: as tabelas + as TRANCAS (RLS)                 │
   │  Storage: os arquivos dos boletos, privados              │
   │  Realtime: avisa quando algo muda → os 4 cartões         │
   └─────────────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────────────┐
   │  BACK-END EXPRESS (opcional, roda na sua máquina)        │
   │  Ler boleto por linha de comando, recarregar unidades    │
   └─────────────────────────────────────────────────────────┘
```

### 7.1 Por que o back-end é opcional

Porque o Supabase **já é** um back-end. Ele tem autenticação, banco, arquivos e
regras de segurança. Colocar um servidor Express no meio só para repassar
pedidos adicionaria uma peça para dar manutenção, sem ganhar nada.

E tem um motivo prático que decide a questão: foi pedido que funcione no
**GitHub Pages**. GitHub Pages serve arquivos e nada mais — não roda Node.
Além disso, ele serve em HTTPS, e uma página HTTPS **não pode** chamar
`http://localhost`. O navegador bloqueia (e está certo em bloquear).

Então: a leitura do boleto acontece **no navegador**, e o back-end fica como
ferramenta de linha de comando e manutenção. Se um dia você publicar o back-end
em algum lugar com HTTPS, basta preencher `API_URL` no `frontend/js/config.js` e
o front-end passa a usá-lo.

### 7.2 O modo demonstração

Como o `config.js` nasce sem as chaves do Supabase, o portal detecta isso e cai
num **modo demonstração** que guarda tudo no próprio navegador. Ele já vem com os
7 boletos de exemplo — os mesmos números do layout que você mandou: 7 boletos,
R$ 21.090 no total, 4 pendentes, 3 associados.

Serve para você **abrir e ver funcionando agora**, antes de criar conta em
qualquer lugar. Uma faixa amarela avisa que está em modo demonstração, e tem um
botão para restaurar os dados de exemplo.

---

## 8. O que decidi de propósito **não** fazer

Vale registrar, para ninguém achar que foi esquecimento:

- **Não** apago boletos. Recusar já resolve e preserva o histórico.
- **Não** deixo o solicitante editar um boleto já enviado. Ele reenvia. Editar
  criaria a dúvida "o operador viu qual versão?".
- **Não** guardo o arquivo em pasta pública. O download nasce com link assinado
  que vale 5 minutos.
- **Não** confio em nada que o navegador manda. Toda regra está no banco também.
- **Não** uso framework nem build no front-end. Não por preferência estética:
  GitHub Pages não roda build, e sem build não existe passo entre "salvei" e
  "está no ar". Menos peças, menos coisa para quebrar.

---

## 9. Como saber se está funcionando

| O que testar | O que deve acontecer |
|---|---|
| Abrir com um e-mail comum | Não aparece o botão de trocar visão |
| Abrir com um dos 13 e-mails | Aparece a escolha das duas visões |
| Digitar `/operador.html` sem ser operador | É mandado embora, com aviso |
| Anexar um boleto em PDF | Valor, vencimento e código aparecem sozinhos |
| Anexar um PDF que não é boleto | Avisa que não conseguiu, campos ficam abertos |
| Colar uma linha digitável com um dígito trocado | Avisa que o verificador não fechou |
| Mandar um boleto em uma aba e olhar o painel em outra | Os 4 cartões mudam sozinhos |
| Clicar no clipe | Baixa o arquivo |
| Clicar no ícone de código de barras | Copia o número |
| Marcar "não regularizado" | Não deixa enviar, e explica o que corrigir |
| Recusar um boleto | O solicitante vê o motivo na lista dele |
| `cd backend && npm test` | 40 passam, 0 falham |

---

## 10. O que faria depois

Em ordem de quanto valor entrega:

1. **Avisar por e-mail** quando um boleto for associado ou recusado.
2. **Enviar vários boletos de uma vez** — arrastar dez PDFs e deixar o sistema
   ler todos.
3. **Um relatório** de quanto tempo cada boleto ficou na fila.
4. **Entrar com a conta Microsoft** da Serena, em vez de mais uma senha.
5. **Marcar boleto repetido** — o banco já bloqueia o mesmo código de barras
   duas vezes, mas dá para avisar o solicitante na hora, antes de ele enviar.
