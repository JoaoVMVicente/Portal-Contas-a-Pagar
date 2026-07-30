# 08 — Fazer o e-mail realmente chegar

O botão "Primeiro acesso" já dispara o envio. Este guia é sobre o que precisa
estar configurado do outro lado para a mensagem sair, chegar, e não cair no spam.

---

## Antes de tudo: o modo demonstração nunca vai mandar e-mail

Isso não tem solução, e não é bug: mandar e-mail exige um servidor de e-mail, e
o modo demonstração não tem servidor nenhum — ele guarda tudo dentro do seu
navegador.

Por isso, em modo demonstração o link aparece na própria tela, com o aviso de
que é simulação. É o mais honesto que se consegue fazer ali.

**Para receber e-mail de verdade, você precisa de um projeto no Supabase**, com
as chaves preenchidas em `frontend/js/config.js`. Faça o
[`02-SUPABASE-SETUP.md`](02-SUPABASE-SETUP.md) primeiro. Isso vale mesmo rodando
na sua máquina: o portal pode estar em `localhost` e o banco na nuvem.

---

## O bug que eu tinha deixado, e que talvez seja o seu problema

Se você já configurou o Supabase e o e-mail não chegou, era isto.

A primeira versão do código chamava só `resetPasswordForEmail`. Essa função do
Supabase **só envia e-mail se a pessoa já existe** no banco de autenticação. Num
primeiro acesso de verdade a conta ainda não existe — então nada era enviado. E o
pior: a tela dizia "link enviado" de qualquer jeito.

Já está corrigido em `frontend/js/dados-supabase.js`. Agora o portal faz dois
passos:

1. Tenta criar a conta com uma senha aleatória e descartável. Conta nova → o
   Supabase manda o e-mail de confirmação. É o que queremos.
2. Se a conta já existia (o Supabase avisa isso de um jeito indireto, devolvendo
   a lista de identidades vazia), chama `resetPasswordForEmail`, que aí sim
   envia.

Sobre a senha aleatória do passo 1: ela nunca é mostrada nem guardada. Existe só
porque a função exige uma senha. Ninguém consegue entrar com ela — nem quem pediu
o link. O único caminho para dentro continua sendo o e-mail.

---

## As três configurações que precisam estar certas

### 1. "Confirm email" LIGADO

**Authentication → Providers → Email**

| Opção | Como deve ficar |
|---|---|
| Enable Email provider | ligado |
| **Confirm email** | **ligado** |
| Allow new users to sign up | ligado |
| Minimum password length | 8 |

Se **Confirm email** estiver desligado, o Supabase cria a conta e entra direto,
sem mandar nada. O portal detecta isso e mostra o aviso em vez de deixar você
esperando — mas o certo é ligar.

Se **Allow new users to sign up** estiver desligado, o passo 1 falha e nenhum
e-mail sai. O portal também avisa nesse caso.

### 2. Redirect URLs cadastradas

**Authentication → URL Configuration**

- **Site URL:** `http://localhost:8080` enquanto testa
- **Redirect URLs:** uma por linha, todos os endereços que você usar:

```
http://localhost:8080/**
http://127.0.0.1:8080/**
http://localhost:8081/**
https://SEU-USUARIO.github.io/**
```

Este é o esquecimento mais comum de todos. O e-mail chega, a pessoa clica, e cai
numa página de erro do Supabase em vez do portal.

### 3. Um serviço de e-mail próprio (SMTP)

Aqui está o ponto que realmente separa "funciona no teste" de "funciona para as
17 pessoas".

O Supabase vem com um serviço de e-mail embutido, mas ele é **só para teste**:
manda pouquíssimos e-mails por hora e não dá garantia de entrega. Convidar a
equipe inteira num dia bate no limite na terceira pessoa.

**Authentication → Emails → SMTP Settings → Enable Custom SMTP**

Você precisa de seis dados. Três caminhos para conseguir:

#### Caminho A — Serviço de e-mail transacional (o que eu recomendo)

São feitos exatamente para isso, e o plano grátis cobre este portal com folga.

| Serviço | Grátis por mês | Observação |
|---|---|---|
| Resend | 3.000 | O mais simples de configurar |
| Brevo | 9.000 | Interface em português |
| Amazon SES | 3.000 | Mais barato em escala, mais burocrático |
| SendGrid | 100/dia | Conhecido |

Em qualquer um: crie a conta, verifique o domínio `srna.co` (o TI precisa
adicionar uns registros DNS), e pegue o host, a porta e a chave.

> A verificação de domínio é o que faz o e-mail sair como
> `portal@srna.co` em vez de cair no spam. Vale insistir com o TI nesse passo.

#### Caminho B — SMTP da própria Serena

A Serena usa Microsoft 365, que tem SMTP. Peça ao TI:

- host, porta, usuário e senha de uma caixa de serviço
- ou um **SMTP relay** interno

Aviso honesto: muitas empresas desligam o SMTP AUTH do Microsoft 365 por política
de segurança, e é bem possível que o TI diga não. Se disser, vá para o caminho A.

#### Caminho C — Deixar o embutido

Serve para você testar com duas ou três pessoas. Não serve para a virada.

### Preencha no Supabase

```
Sender email  : portal@srna.co
Sender name   : Portal Serena
Host          : (do seu provedor)
Port          : 587
Username      : (do seu provedor)
Password      : (do seu provedor)
```

---

## Deixar os e-mails em português

Por padrão as mensagens saem em inglês, o que fica estranho num portal interno.

**Authentication → Emails → Templates**

### Confirm signup — é este que o primeiro acesso usa

**Subject:**

```
Ative seu acesso ao Portal Serena
```

**Message body:**

```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#2e2e2e;">
  <p style="font-size:20px;font-weight:bold;color:#ff5246;margin:0 0 24px;">serena</p>

  <h2 style="font-size:22px;margin:0 0 12px;">Ative seu acesso</h2>

  <p style="font-size:15px;line-height:1.6;color:#5a5a5a;margin:0 0 24px;">
    Você recebeu este e-mail porque pediu o primeiro acesso ao
    <strong>Portal de Associação de Boletos</strong> da Serena.
    Clique no botão abaixo para escolher sua senha.
  </p>

  <p style="margin:0 0 28px;">
    <a href="{{ .ConfirmationURL }}"
       style="display:inline-block;background:#ff5246;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:bold;">
      Escolher minha senha
    </a>
  </p>

  <p style="font-size:13px;line-height:1.6;color:#8b8b8b;margin:0 0 8px;">
    O link vale por 24 horas e só pode ser usado uma vez.
  </p>
  <p style="font-size:13px;line-height:1.6;color:#8b8b8b;margin:0 0 24px;">
    Se não foi você que pediu, ignore esta mensagem. Nada acontece com a sua
    conta e ninguém consegue entrar sem abrir este link.
  </p>

  <hr style="border:none;border-top:1px solid #e7e4e1;margin:0 0 16px;" />
  <p style="font-size:12px;color:#8b8b8b;margin:0;">
    Serena Energia · mensagem automática, não responda
  </p>
</div>
```

### Reset password — para "Esqueci minha senha"

**Subject:**

```
Redefinir sua senha do Portal Serena
```

Use o mesmo corpo, trocando o título para "Redefinir sua senha", o texto para
"Clique no botão abaixo para escolher uma nova senha" e o botão para "Escolher
nova senha".

### Invite user — para o script `convidar-equipe.mjs`

**Subject:**

```
Seu acesso ao Portal Serena está pronto
```

Mesmo corpo, com o título "Seu acesso está pronto" e o botão "Criar minha senha".

> O `{{ .ConfirmationURL }}` é obrigatório — é ele que virou o link. Não mexa
> nesse pedaço.

---

## Convidar a equipe de uma vez

Em vez de pedir para cada pessoa clicar em "Primeiro acesso", você pode puxar os
convites:

```bash
cd tools
npm install

# Ver quem seria convidado, sem mandar nada:
node convidar-equipe.mjs --simular

# Mandar de verdade:
node convidar-equipe.mjs

# Só uma pessoa:
node convidar-equipe.mjs --email alguem@srna.co

# Reenviar para quem foi convidado mas não entrou ainda:
node convidar-equipe.mjs --reenviar
```

O script lê a lista de `db/06_seed_admins.sql` — então existe uma fonte só. Ele
pula quem já ativou a conta, dá uma pausa entre os envios para não estourar o
limite, e se estourar, para e avisa (rodando de novo, continua de onde parou).

Ele precisa da chave `service_role` em `backend/.env`. Essa chave ignora todas as
travas do banco, então roda **só na sua máquina** — nunca no navegador, nunca no
GitHub.

---

## Testar

1. No Supabase: **Authentication → Users**, apague sua própria conta de teste
   (se já criou uma).
2. Abra o portal, clique em **Primeiro acesso**, digite seu e-mail.
3. O e-mail deve chegar em menos de um minuto.
4. Clique no link → deve abrir a tela **"Escolha sua senha"** do portal.
5. Escolha a senha → deve entrar já como operador, se seu e-mail está na lista.

Confira no banco que a conta nasceu certa:

```sql
select p.email, p.nome_completo, p.papel, p.escopo,
       u.email_confirmed_at is not null as confirmado
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.criado_em desc
 limit 5;
```

---

## Quando não chega

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Nada chega, nenhum erro na tela | SMTP não configurado, ou limite do embutido | Configure o SMTP |
| "For security purposes... seconds" | Dois pedidos muito seguidos | Espere um minuto |
| "Email rate limit exceeded" | Limite do serviço embutido | Configure o SMTP |
| Aviso de "Confirm email desligado" | A opção está desligada no projeto | Ligue em Providers → Email |
| Aviso de "criação de contas desligada" | "Allow new users to sign up" desligado | Ligue |
| Chega, mas o link dá erro | Endereço não está nas Redirect URLs | Cadastre com `/**` no fim |
| Chega, o link abre, mas volta para o login | A sessão não foi detectada | Confira se a URL tem `?definir-senha=1` |
| Cai no spam | Domínio não verificado no provedor | Verifique o domínio (registros DNS, com o TI) |
| Chega para `@srna.co` mas não para `@ext.srna.co` | Filtro do provedor, ou domínio diferente | Confirme com o TI se o domínio externo recebe |

Para ver o que o Supabase tentou enviar: **Logs → Auth Logs**, no painel.
