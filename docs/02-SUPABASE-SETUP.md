# 02 — Criar o banco no Supabase

O Supabase é um Postgres na nuvem com autenticação, armazenamento de arquivos e
avisos em tempo real já prontos. O plano grátis dá conta deste portal com folga.

Tempo: cerca de 15 minutos. Não precisa cartão de crédito.

---

## O que o plano grátis dá

| Recurso | Limite grátis | Quanto o portal usa |
|---|---|---|
| Banco Postgres | 500 MB | Um boleto ocupa menos de 1 KB. Cabem centenas de milhares. |
| Arquivos | 1 GB | Um boleto em PDF tem uns 100 KB. Cabem ~10 mil. |
| Usuários | 50.000 ativos por mês | Você tem dezenas. |
| E-mails de confirmação | 3 por hora | Suficiente para cadastrar aos poucos. Veja a nota no fim. |
| Tempo real | 200 conexões simultâneas | Suficiente. |

> **Atenção ao único limite que incomoda:** projetos grátis são **pausados
> depois de 7 dias sem nenhum acesso**. Basta abrir o painel e clicar em
> "Restore" para voltar, sem perder nada. Se o portal for usado toda semana,
> isso nunca acontece.

---

## Passo 1 — Criar o projeto

1. Vá em <https://supabase.com> e crie a conta (dá para entrar com GitHub).
2. **New project**.
3. Preencha:
   - **Name:** `portal-boletos-serena`
   - **Database Password:** gere uma senha forte e **guarde num gerenciador de
     senhas**. Você vai precisar dela se um dia quiser conectar por SQL direto.
   - **Region:** `South America (São Paulo)` — a mais perto, a mais rápida.
4. **Create new project** e espere uns 2 minutos.

---

## Passo 2 — Rodar os 8 arquivos SQL, na ordem

No menu da esquerda: **SQL Editor** → **New query**.

Para cada arquivo da pasta `db/`, **na ordem numérica**: abra o arquivo, copie
todo o conteúdo, cole no editor e clique em **Run**.

| Ordem | Arquivo | O que cria | Como saber que deu certo |
|---|---|---|---|
| 1 | `01_schema.sql` | As tabelas | "Success. No rows returned" |
| 2 | `02_functions_triggers.sql` | As automações | idem |
| 3 | `03_views.sql` | A visão da tabela do operador | idem |
| 4 | `04_rls.sql` | **As trancas de segurança** | idem |
| 5 | `05_storage.sql` | O depósito de arquivos | idem |
| 6 | `06_seed_admins.sql` | Os 13 e-mails da equipe | idem |
| 7 | `07_seed_contas.sql` | 213 empresas e 1.127 contas | idem |
| 8 | `08_realtime.sql` | O aviso em tempo real | idem |

> **Não pule a ordem.** O arquivo 4 tranca tabelas que o arquivo 1 criou. O 7
> preenche uma tabela que o 1 criou. Fora de ordem, dá erro.

### Conferir se ficou tudo certo

Rode isto no SQL Editor:

```sql
-- Devem aparecer 7 tabelas, todas com rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- Devem aparecer os 13 e-mails da equipe
select count(*) as admins from admin_emails;

-- Devem aparecer 213 empresas e 1073 contas ativas
select count(*) as empresas from empresas where ativo;
select count(*) as contas from contas_bancarias where ativo;

-- Os escopos: 2 'ambos', 2 'MD', 13 'NF'
select escopo, count(*) from admin_emails group by escopo;

-- Os quatro cartões, ainda zerados
select * from kpis_boletos();
```

Se alguma tabela vier com `rowsecurity = false`, **rode o `04_rls.sql`
novamente**. Sem isso, os dados ficam abertos.

---

## Passo 3 — Configurar a autenticação

**Authentication** → **Providers** → **Email**:

- **Enable Email provider:** ligado
- **Confirm email:** **ligado** ← isso é a verificação de e-mail que foi pedida
- **Secure email change:** ligado
- **Minimum password length:** 8

**Authentication** → **URL Configuration**:

- **Site URL:** enquanto testa, `http://localhost:8080`. Depois de publicar,
  troque pelo endereço do GitHub Pages.
- **Redirect URLs:** adicione todos que você vai usar, um por linha:

```
http://localhost:8080/**
http://127.0.0.1:8080/**
https://SEU-USUARIO.github.io/**
```

> Se esquecer de cadastrar aqui, o link de confirmação do e-mail leva a pessoa
> para uma página de erro. É o esquecimento mais comum.

### Só deixar entrar quem é da Serena

Isso **já está** no `db/02_functions_triggers.sql` — o gatilho
`trg_bloquear_dominio_externo` recusa qualquer e-mail que não termine em
`@srna.co` ou `@ext.srna.co`, direto na tabela `auth.users`.

Para conferir:

```sql
select public.dominio_liberado('alguem@srna.co')      as deve_ser_true,
       public.dominio_liberado('alguem@ext.srna.co')  as deve_ser_true_tambem,
       public.dominio_liberado('alguem@gmail.com')    as deve_ser_false;
```

Para acrescentar um domínio no futuro, mexa em dois lugares: a função
`public.dominio_liberado` e a lista `DOMINIOS_PERMITIDOS` em
`frontend/js/config.js`.

## Passo 4 — Conferir o depósito de arquivos

**Storage**. Deve existir um balde chamado **`boletos`**, marcado como
**privado** (não público).

Se estiver público, corrija na hora: **⋯** → **Edit bucket** → desmarque
**Public**. Balde público significa que qualquer pessoa com o link vê o boleto.

---

## Passo 5 — Pegar as chaves

**Project Settings** (a engrenagem) → **API**:

| O que copiar | Onde colocar | Pode ser público? |
|---|---|---|
| **Project URL** | `frontend/js/config.js` → `SUPABASE_URL` | Sim |
| **anon public** | `frontend/js/config.js` → `SUPABASE_ANON_KEY` | Sim |
| **service_role** | Só em `backend/.env` | **NUNCA** |

> **Por que a chave `anon` pode ficar à vista?** Porque ela não dá permissão
> nenhuma por si só. Ela apenas identifica o projeto. Quem decide o que cada
> pessoa vê é o RLS, com base em quem está logado. Já a `service_role` ignora o
> RLS inteiro — se ela vazar, o banco todo vaza.

---

## Passo 6 — Testar de ponta a ponta

1. Suba o front-end (`python3 -m http.server 8080` dentro de `frontend/`).
2. Tente entrar com um dos e-mails da equipe. Vai dar erro — é o esperado.
3. Use o **Primeiro acesso**. O link chega no e-mail de verdade agora.
4. Abra o link, escolha a senha, entre. Deve aparecer a escolha entre as
   duas visões, e o papel de operador já vem aplicado.
5. Vá para a visão do cliente e envie um boleto de verdade.
6. Volte para a visão do operador. O boleto deve estar lá e os cartões devem
   ter mudado.

Confirme no banco que os dados chegaram:

```sql
select numero_protocolo, tipo_documento, numero_documento,
       cc, unidade_negocio, valor, vencimento, status
from boletos
order by data_envio desc
limit 5;
```

---

## Nota sobre o limite de 3 e-mails por hora

O serviço de e-mail que vem no plano grátis é para teste. Se você for cadastrar
as 13 pessoas de uma vez, vai bater no limite.

Duas saídas:

**Saída rápida** — confirme à mão: **Authentication** → **Users** → clique na
pessoa → **Confirm email**.

**Saída definitiva** — ligue um serviço de e-mail próprio (SMTP) em
**Project Settings** → **Authentication** → **SMTP Settings**. Se a Serena usa
Microsoft 365, o time de TI consegue os dados de SMTP. Assim os e-mails saem com
o domínio da empresa e sem limite baixo.
