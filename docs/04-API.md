# 04 — As APIs

Existem **duas** formas de o portal falar com o banco. Explicar as duas evita
confusão sobre "onde está a API".

| Via | Quem usa | Como |
|---|---|---|
| **Front-end → Supabase** | O portal, no navegador | Biblioteca oficial do Supabase, direto |
| **Back-end Express → Supabase** | Terminal, scripts, manutenção | Rotas HTTP em `/api/...` |

A primeira é o caminho normal. A segunda é ferramenta.

---

## Parte 1 — O que o front-end chama no banco

O front-end nunca monta SQL. Ele chama **funções** e lê **visões** que já vêm
prontas do banco, com as regras dentro.

### Funções (RPC)

| Função | Parâmetros | O que faz | Quem pode |
|---|---|---|---|
| `kpis_boletos(p_tipo)` | tipo_documento ou `null` | Os quatro números dos cartões. Passar `'NF'` ou `'MD'` filtra; `null` traz o que a pessoa pode ver | Respeita o escopo |
| `associar_boleto(p_boleto_id, p_observacao)` | uuid, texto | Marca como associado, grava quem e quando | Só operador |
| `recusar_boleto(p_boleto_id, p_motivo)` | uuid, texto | Devolve ao solicitante com o motivo | Só operador |
| `reabrir_boleto(p_boleto_id, p_observacao)` | uuid, texto | Volta para pendente | Só operador |
| `contas_da_empresa(p_documento)` | texto | As contas ativas de uma empresa | Qualquer pessoa logada |
| `empresa_da_conta(p_conta)` | texto | O caminho inverso: a conta diz qual é a empresa. Aceita com ou sem traço | Qualquer pessoa logada |
| `buscar_empresas(p_termo, p_limite)` | texto, int | Busca por nome ou CNPJ. O nome usa a chave normalizada, então "assurua 2 4" acha "ASSURUÁ 2 IV" | Qualquer pessoa logada |
| `meu_escopo()` | — | `NF`, `MD` ou `ambos` | Qualquer pessoa logada |
| `posso_ver_tipo(p_tipo)` | tipo_documento | Se eu tenho direito de ver aquele tipo | Qualquer pessoa logada |
| `eh_admin()` | — | Diz se quem chamou é operador | Qualquer pessoa logada |
| `meu_papel()` | — | Devolve `admin` ou `cliente` | Qualquer pessoa logada |

Exemplo de chamada no front-end:

```js
const { data, error } = await supabase.rpc('associar_boleto', {
  p_boleto_id: '0f8c...',
  p_observacao: null,
});
```

> **Por que função em vez de UPDATE direto?** Porque associar um boleto não é
> "mudar um campo". É: conferir se está pendente, gravar quem fez, gravar a hora,
> e registrar no histórico. Se isso ficasse no JavaScript, cada tela poderia
> fazer de um jeito diferente — e uma delas esqueceria o histórico. Como função
> no banco, é sempre igual, e não tem como pular etapa.

### Visões

| Visão | O que entrega |
|---|---|
| `vw_boletos_operador` | Uma linha por boleto, com as colunas já nomeadas como aparecem na tela, mais `situacao_vencimento` e `dias_para_vencer` calculados |
| `vw_kpis` | Os quatro números, em formato de tabela |
| `vw_empresas` | As 213 empresas com a contagem de contas ativas |
| `vw_contas` | As contas com o nome da empresa e um rótulo pronto para o seletor |

A visão respeita o RLS, e agora em dois eixos: o solicitante vê só os boletos
dele; o operador vê os de todo mundo, **mas só do tipo de documento que ele
trabalha**. **A mesma consulta devolve resultados diferentes para pessoas
diferentes**, e é exatamente isso que se quer.

### Tabelas que o front-end lê direto

`profiles` (só a própria ficha), `empresas`, `contas_bancarias`,
`departamentos`, `boleto_eventos` (só de boletos que a pessoa pode ver).

### Insert de boleto

O único insert que o front-end faz é em `boletos`. O RLS impõe:

- `solicitante_id` tem que ser o próprio usuário;
- `status` tem que ser `pendente`;
- o par `cc` + `unidade_cnpj` tem que existir em `contas_bancarias` e estar ativo.

Essa última é imposta pelo gatilho `trg_validar_conta`, que além de conferir
**preenche** o nome da empresa, o banco e o tipo da conta a partir da tabela —
em vez de confiar no que veio da tela. Se o par não existir, o erro é
`CONTA_INVALIDA`.

### Arquivos

```js
// Subir
await supabase.storage.from('boletos').upload(caminho, arquivo);

// Baixar (link que vale 5 minutos)
await supabase.storage.from('boletos').createSignedUrl(caminho, 300);
```

O caminho é `<id-do-usuário>/<ano>/<mês>/<carimbo>-<nome>`. O RLS do Storage
confere a primeira pasta contra o id de quem pede, então ninguém acessa o
arquivo de outra pessoa. Operador acessa todos.

### Tempo real

```js
supabase
  .channel('boletos')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'boletos' },
      () => { atualizarKpis(); recarregarTabela(); })
  .subscribe();
```

É isso que faz os quatro cartões mudarem sozinhos.

---

## Parte 2 — As rotas do back-end Express

Só existem se você rodar `npm start` dentro de `backend/`. Endereço padrão:
`http://localhost:3333`.

### Autenticação

Toda rota, menos `/api/saude` e `/api/extracao/*`, exige o cabeçalho:

```
Authorization: Bearer <token>
```

O token é o `access_token` da sessão do Supabase. No navegador logado, pegue no
console:

```js
const { data } = await window.supabase.auth.getSession();
console.log(data.session.access_token);
```

O back-end **não decide** nada de permissão por conta própria: ele repassa o
pedido ao banco usando o token da pessoa, e o RLS decide. Um lugar só com as
regras.

### `GET /api/saude`

Sem autenticação. Diz se o servidor está no ar e o que está configurado.

```bash
curl http://localhost:3333/api/saude
```

### `POST /api/extracao/arquivo`

Sem autenticação — ela não toca no banco. Manda um arquivo, recebe os dados.

```bash
curl -F arquivo=@boleto.pdf http://localhost:3333/api/extracao/arquivo
```

Resposta:

```json
{
  "ok": true,
  "arquivo": { "nome": "boleto.pdf", "tamanho": 84213, "tipo": "application/pdf" },
  "milissegundos": 412,
  "codigoBarras": "00193373700000001000500940144816060680935031",
  "linhaDigitavel": "00190500954014481606906809350314337370000000100",
  "valor": 1,
  "vencimento": "2032-08-21",
  "banco": "001",
  "bancoNome": "Banco do Brasil",
  "confianca": "alta",
  "metodo": "linha-digitavel",
  "origem": "texto-do-pdf",
  "vencimentoAmbiguo": true,
  "avisos": ["O fator de vencimento pode se referir a dois ciclos diferentes..."]
}
```

O campo **`confianca`** é o que importa: `alta` significa que o dígito
verificador fechou — o número está matematicamente correto, não "provavelmente
correto".

### `POST /api/extracao/codigo`

Confere e interpreta um número digitado. Aceita 44, 47 ou 48 dígitos.

```bash
curl -X POST http://localhost:3333/api/extracao/codigo \
  -H "Content-Type: application/json" \
  -d '{"codigo":"00190500954014481606906809350314337370000000100"}'
```

### `GET /api/boletos`

Parâmetros: `tipo` (`NF` ou `MD`), `status`, `cc`, `busca`, `pagina`,
`porPagina`, `ordenarPor`, `ordem`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3333/api/boletos?status=pendente&porPagina=10"
```

### `GET /api/boletos/kpis`

Os quatro números.

### `GET /api/boletos/:id`

Um boleto, com o histórico e a linha digitável formatada.

### `GET /api/boletos/:id/arquivo`

Devolve `{ url, nome, validoPorSegundos }`. A URL vale 5 minutos.

### `POST /api/boletos/:id/associar`

Só operador. Corpo opcional: `{ "observacao": "..." }`.

### `POST /api/boletos/:id/recusar`

Só operador. Corpo: `{ "motivo": "..." }` — mínimo de 5 caracteres, porque o
solicitante vai ler.

### `POST /api/boletos/:id/reabrir`

Só operador. Desfaz a associação.

### `GET /api/contas/empresas?busca=...` · `GET /api/contas/empresas/:documento` · `GET /api/contas/:conta`

Busca de empresa, contas de uma empresa, e o caminho inverso (a conta diz qual
é a empresa).

### `POST /api/admin/recarregar-contas`

Só operador. Lê `frontend/data/contas-bancarias.json` e sobe para o banco.
Precisa da chave `service_role` no `.env`.

### `GET /api/admin/conferir-contas`

Compara o JSON com o banco e mostra o que está diferente nos dois lados.

---

## Formato dos erros

Sempre o mesmo formato, sempre em português:

```json
{ "erro": "sem_permissao", "mensagem": "Esta area e so para a equipe de operacao." }
```

| Código HTTP | Quando |
|---|---|
| 400 | Faltou dado, ou o dado está errado |
| 401 | Sem token, ou token expirado |
| 403 | Logado, mas sem permissão, e-mail não confirmado, ou boleto fora do seu escopo (`FORA_DO_ESCOPO`) |
| 404 | Não existe, ou você não tem direito de ver (o RLS esconde) |
| 413 | Arquivo passou de 10 MB |
| 429 | Muitos pedidos em pouco tempo |
| 503 | O back-end está sem Supabase configurado |

---

## Uma nota sobre 404 e privacidade

Quando o RLS esconde uma linha, o banco simplesmente devolve "não encontrei" —
não "existe mas você não pode ver". É de propósito: a segunda resposta
confirmaria a existência do boleto para quem não deveria nem saber disso.
