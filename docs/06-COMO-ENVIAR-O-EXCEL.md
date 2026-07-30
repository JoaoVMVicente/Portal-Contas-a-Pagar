# 06 — Importar o Mapeamento Geral de Contas

Este guia transforma a planilha `Mapeamento_Geral_de_Contas_2023_Equipe.xlsx`
nos dados que o portal usa.

---

## O que a planilha é, de fato

Vale começar por aqui, porque a leitura da planilha mudou uma premissa do
projeto.

A coluna **I (CONTA)** não é um código de centro de custo. É a **conta
bancária** da empresa. E uma empresa tem várias — a maior do grupo tem **31**.

Então a relação é o inverso do que parecia no começo:

```
ANTES (o que eu supunha):   1 código de conta  ->  N empresas
AGORA (o que a planilha diz):   1 empresa      ->  N contas bancárias
```

Consequência prática no formulário: primeiro se identifica a **empresa** (o CNPJ
vem do boleto), e só depois a pessoa escolhe **qual conta** daquela empresa.
O caminho inverso também funciona — digitar o número da conta identifica a
empresa, porque conta praticamente nunca se repete.

## Colunas usadas

| Coluna | Nome | Para que serve |
|---|---|---|
| A | GRUPO ECONOMICO | Agrupador (SG, SD, VDB, US, CONS, ARCO) |
| B | CÓDIGO | Código interno da empresa |
| **C** | **EMPRESA** | Razão social |
| **D** | **CNPJ** | A chave que liga o boleto à empresa |
| E | BANCO | Diferencia contas da mesma empresa |
| F | CÓD. BANCO | Número do banco |
| H | AGÊNCIA | Idem |
| **I** | **CONTA** | O "CC" do portal |
| J | TIPO DE CONTA | LIVRE, VINCULADA, ENCERRADA... |

---

## Rodando

```bash
cd portal-boletos-serena/tools
npm install

# 1. Espiar sem alterar nada
node excel-para-json.mjs --arquivo "../Mapeamento_Geral_de_Contas_2023_Equipe.xlsx" --inspecionar

# 2. Importar
node excel-para-json.mjs --arquivo "../Mapeamento_Geral_de_Contas_2023_Equipe.xlsx"
```

A aba `BASE GERAL` já é o padrão, e as colunas são reconhecidas pelo nome — não
precisa passar parâmetro nenhum.

### O que sai

| Arquivo | Para quê |
|---|---|
| `frontend/data/contas-bancarias.json` | O formulário. Já vem com os cruzamentos prontos, então a busca é instantânea. |
| `db/07_seed_contas.sql` | Carrega no banco. É a **verdade**: cada boleto é conferido contra ela. |

Por que os dois? Porque cada um serve para uma coisa. O JSON é velocidade de
tela. A tabela é autoridade: quando um boleto é gravado, o banco confere se
aquele par empresa + conta existe e está ativo. Se alguém tentar mandar uma
combinação inventada — mesmo mexendo no JavaScript — o banco recusa.

### O resultado da sua planilha

```
Empresas          : 213
Contas bancárias  : 1127
  ativas          : 1073
  encerradas      : 54   (guardadas, mas fora do formulário)
```

---

## As três coisas que precisaram de tratamento especial

### 1. Algarismos romanos nos nomes

Os nomes usam romanos: `ASSURUÁ 2 IV ENERGIA S.A.`, `DELTA 7 I`. São **107 das
233 razões sociais**. E quem digita escreve "delta 7 1".

O importador guarda, junto de cada empresa, uma **chave de busca** em que os
romanos soltos viram números árabes, os acentos saem e o "S.A." é descartado:

```
"ASSURUÁ 2 IV ENERGIA S.A."  ->  "ASSURUA 2 4 ENERGIA"
"assurua 2 4"                ->  "ASSURUA 2 4"
```

Como os dois lados passam pela mesma normalização, encontram a mesma empresa.
Funciona nos dois sentidos: digitar em romano também acha.

### 2. A conta vem com traço

`37700-7`, `000577081425-6`. Guardamos as duas formas: a original, para exibir
igual à planilha, e só os dígitos, para procurar. Quem digita `377007` encontra
`37700-7`.

### 3. Contas encerradas

**54 contas** estão marcadas como `CONTA ENCERRADA`. Elas entram no arquivo, mas
com `ativa: false`, e **não aparecem** para escolher no formulário. Ficam para
o histórico dos boletos antigos continuar legível.

---

## O que o importador rejeitou, e por quê

Nada foi rejeitado — mas duas situações mereceram tratamento:

**Sete empresas dos Estados Unidos** (as `LLC`, do grupo Goodnight) têm **EIN de
9 dígitos**, não CNPJ de 14. Elas seriam rejeitadas por "CNPJ inválido", o que
estaria errado: o documento está certo, só não é brasileiro. Ficam marcadas como
`documentoTipo: 'ein'` e a tela mostra "EIN 123456789" em vez de tentar formatar
como CNPJ.

**Seis CNPJs aparecem com mais de um nome** — casos de renomeação (por exemplo
`VDB F2 GERACAO` e `VDB F2 GERAÇÃO`, ou `ARCO ENERGIA 2` e `ARCO ENERGIA T1`).
O nome mais longo vira o principal; o outro fica como apelido, e a busca acha
pelos dois. As abas `MUDANÇA DE DENOMINAÇÕES` da planilha confirmam que são a
mesma empresa.

**Uma conta aparece em duas empresas.** O importador avisa no fim da execução.
Não é erro — mas identificar aquela conta só pelo número fica ambíguo, então
vale saber que existe.

---

## Carregar no banco

Copie o conteúdo de `db/07_seed_contas.sql` e rode no **SQL Editor** do Supabase.

Confira:

```sql
select count(*) from public.empresas where ativo;          -- 213
select count(*) from public.contas_bancarias where ativo;  -- 1073

-- Uma empresa e suas contas
select razao_social, c.conta, c.banco, c.tipo_conta
  from public.empresas e
  join public.contas_bancarias c on c.empresa_documento = e.documento
 where e.chave_busca like 'ASSURUA 2 4%' and c.ativo;
```

---

## Recarregar quando a planilha mudar

Rode o importador de novo e execute o SQL gerado. A estratégia é cuidadosa:
primeiro marca **tudo** como inativo, depois reativa o que veio na planilha.

- Empresa nova → entra
- Empresa renomeada → atualiza
- Conta encerrada na planilha → fica inativa
- Empresa que saiu da planilha → fica **inativa**, não é apagada

A última linha importa: apagar deixaria os boletos antigos apontando para o
nada. Inativa, ela sai da lista de escolha mas o histórico continua fazendo
sentido.

---

## Opções

| Opção | O que faz |
|---|---|
| `--arquivo <caminho>` | O Excel. **Obrigatório.** |
| `--inspecionar` | Só olha e mostra, sem gerar nada |
| `--aba <nome>` | Padrão: `BASE GERAL` |
| `--linha-cabecalho <n>` | Padrão: descobre sozinho |
| `--col-empresa`, `--col-cnpj`, `--col-conta` | Se o nome da coluna mudar |
| `--col-banco`, `--col-agencia`, `--col-tipo` | Idem, para o contexto da conta |
| `--sem-encerradas` | Nem inclui as contas encerradas no arquivo |
| `--saida-json`, `--saida-sql` | Onde gravar |
