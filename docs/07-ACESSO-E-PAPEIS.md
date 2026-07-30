# 07 — Acesso, papéis e escopos

Quem entra, como entra, e o que cada pessoa vê depois de entrar.

---

## 1. Quem pode entrar

Dois domínios:

| Domínio | Quem é | Pode ser operador? |
|---|---|---|
| `@srna.co` | Quadro próprio | Sim |
| `@ext.srna.co` | Terceirizados | **Sim** |

Ser terceirizado não limita nada. A tela mostra um "· externo" discreto ao lado
do nome, e é só isso — serve para a operação saber com quem está falando, não
para restringir.

Qualquer outro domínio é recusado em **dois** lugares:

1. Na tela, para dar mensagem clara.
2. No banco, num gatilho em `auth.users` — e este é o que vale. Mesmo que
   alguém contorne a tela, o banco não cria o usuário.

Para acrescentar um domínio no futuro, mexa em dois pontos: a lista
`DOMINIOS_PERMITIDOS` em `frontend/js/config.js` e a função
`public.dominio_liberado` em `db/02_functions_triggers.sql`.

---

## 2. Como alguém entra pela primeira vez

Este é o ponto que mais gerou discussão, então vale registrar o raciocínio
inteiro.

### O risco

Os e-mails da equipe já estão cadastrados em `admin_emails`. A preocupação
levantada foi exata: *"eu poderia criar uma senha para todo mundo do meu time
sem eles saberem"*.

### Por que "definir a senha na tela" não resolve

A ideia inicial era: ao tentar entrar, aparece um botão "Primeiro acesso", com o
e-mail já identificado, um campo de senha e um botão de entrar.

Isso resolveria a metade visual do problema, mas não a de segurança — porque
continuaria possível digitar o e-mail de um colega e definir a senha dele. O
obstáculo tem que ser algo que só a pessoa tem.

### O que existe de fato

**A caixa de e-mail.** É a única coisa que só aquela pessoa (e o TI) controla.
Então o primeiro acesso funciona assim:

```
1. A pessoa tenta entrar          ->  não dá certo (não tem senha ainda)
2. Aparece o botão "Primeiro acesso", com o e-mail já preenchido
3. Ela pede o link                ->  o link vai para a caixa de e-mail DELA
4. Ela abre o link                ->  ISTO é a prova
5. Só agora escolhe a senha       ->  e entra
```

A etapa 4 é o que torna impossível criar senha por outra pessoa. Sem acesso
àquela caixa de entrada, o caminho para na etapa 3.

### Por que o botão aparece para todo mundo

O botão "Primeiro acesso" aparece depois de **qualquer** tentativa que não deu
certo — não só quando o e-mail está pré-cadastrado.

Se aparecesse apenas para os pré-cadastrados, a tela viraria uma lista de quem
trabalha aqui: bastaria testar e-mails e observar em quais o botão surge. Por
isso a resposta ao pedido de link também é sempre a mesma frase, exista a conta
ou não: *"se este e-mail estiver liberado, o link foi enviado"*.

É um caso em que a interface é ligeiramente menos informativa de propósito.

### Não existe mais "criar conta"

Antes havia uma aba de cadastro separada. Foi removida, porque fazia o mesmo que
o primeiro acesso, com dois caminhos para manter e dois lugares para errar.
Todo mundo entra pelo mesmo fluxo, do estagiário ao diretor.

### Para o e-mail realmente chegar

O código já dispara o envio, mas depende de configuração do outro lado: "Confirm
email" ligado, as Redirect URLs cadastradas e — o que mais importa — um serviço
de SMTP próprio, porque o embutido do Supabase manda pouquíssimos e-mails por
hora. Está tudo em [`08-EMAIL-DE-VERDADE.md`](08-EMAIL-DE-VERDADE.md), inclusive
os modelos de e-mail em português e o script que convida a equipe inteira de uma
vez.

### No modo demonstração

Não existe e-mail de verdade. Então o link aparece na própria tela, com o aviso
de que é simulação. Os e-mails da equipe já vêm cadastrados **sem senha**, igual
ao portal de verdade — tentar entrar direto dá erro, e o caminho é o primeiro
acesso. A senha, mesmo na demonstração, é guardada como resumo SHA-256, nunca
como texto legível.

---

## 3. Papel: cliente ou operador

| Papel | Vê | Como se torna |
|---|---|---|
| `cliente` | Só os boletos que ela mesma enviou | É o padrão |
| `admin` | A fila de boletos de todo mundo | O e-mail está em `admin_emails` |

O papel é aplicado automaticamente quando a conta é ativada, por um gatilho.
Ninguém promove ninguém à mão.

Mexeu em `admin_emails` depois? Outro gatilho ajusta os papéis na hora. Tirar
alguém da tabela devolve o papel de cliente.

Um operador **não consegue** se rebaixar nem se promover pela tela: a política
de `update` em `profiles` bloqueia mudanças nas colunas `papel` e `escopo`.

---

## 4. Escopo: NF, MD ou as duas

Esta é a parte nova. Nem todo operador cuida do mesmo tipo de documento.

| Escopo | Enxerga | Como é a tela |
|---|---|---|
| `NF` | Só notas fiscais | Sem alternador. Um selo diz "você trabalha com notas fiscais". |
| `MD` | Só medições | Igual, para medições. |
| `ambos` | As duas | Alternador no topo, com o número de pendentes de cada lado. |

### Quem tem o quê

| Pessoas | Escopo | Por quê |
|---|---|---|
| João Vicente e Pedro Moreira | `ambos` | Responsáveis pelo processo inteiro |
| Thaís Lima e Karoline Lima | `MD` | Time de medições |
| Restante da equipe (13 pessoas) | `NF` | Notas fiscais é o dia a dia |

Isso está em `db/06_seed_admins.sql`. Para mudar alguém de escopo, basta um
comando:

```sql
update public.admin_emails
   set escopo = 'ambos'
 where email = 'alguem@srna.co';
```

O gatilho sincroniza o perfil na hora — a pessoa não precisa sair e entrar de
novo, só recarregar a página.

### O escopo não é só um filtro na tela

Isto importa: a restrição está no **RLS do Postgres**, na política de leitura da
tabela `boletos`. Quem tem escopo `NF` recebe uma lista vazia se pedir medições,
mesmo mandando o comando direto pelo console do navegador. As funções
`associar_boleto`, `recusar_boleto` e `reabrir_boleto` também checam, e recusam
com a mensagem `FORA_DO_ESCOPO`.

Duas trancas para a mesma porta: a tela é educada, o banco é definitivo.

### Por que uma tela só, e não duas páginas

Poderia existir `operador-nf.html` e `operador-md.html`. Não existe, e por três
motivos:

1. Duas páginas com o mesmo layout são duas cópias para manter. Consertar a
   coluna de vencimento numa e esquecer a outra é questão de tempo.
2. Quem só vê NF nunca precisa saber que MD existe: sem aba estranha, sem
   alternador inútil. A tela parece feita para ela.
3. Quem vê as duas ganha o contador de pendentes do outro lado, e descobre que
   tem medição esperando sem precisar trocar de tela.

---

## 5. Visão: qual tela estou olhando

Um quarto conceito, e o mais fácil de confundir com os outros:

| Conceito | Onde vive | Muda? |
|---|---|---|
| **Papel** | Banco | Só por ato administrativo |
| **Escopo** | Banco | Só por ato administrativo |
| **Visão** (cliente/operador) | Navegador | A pessoa troca quando quiser |
| **Tipo ativo** (NF/MD) | Navegador | Idem, se o escopo for `ambos` |

Um operador pode estar na visão de cliente porque ele também tem boletos para
enviar. Um cliente **nunca** consegue visão de operador: digitar
`/operador.html` na barra de endereço leva de volta, e mesmo que não levasse, o
banco não devolveria as linhas dos outros.

---

## 6. Como testar se está tudo certo

| Teste | Resultado esperado |
|---|---|
| Entrar com e-mail `@gmail.com` | Recusado, com mensagem sobre os domínios |
| Entrar com e-mail da equipe, sem ativar | Erro + botão "Primeiro acesso" |
| Pedir primeiro acesso para um e-mail que não existe | A **mesma** mensagem de sempre |
| Ativar pelo link e entrar | Entra, já como operador |
| Entrar como quem tem escopo `NF` | Sem alternador; só notas fiscais na fila |
| Entrar como quem tem escopo `MD` | Sem alternador; só medições |
| Entrar como quem tem escopo `ambos` | Alternador com os dois contadores |
| Forçar `dados.listarBoletos({tipo:'MD'})` no console sendo de `NF` | Lista vazia |
| Um cliente digitar `/operador.html` | Volta para a tela de cliente, com aviso |
