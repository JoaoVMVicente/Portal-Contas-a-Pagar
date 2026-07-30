-- ===========================================================================
-- 01_schema.sql — As "gavetas" do armário
-- ===========================================================================
-- Rode este arquivo PRIMEIRO. Os outros dependem dele.
--
-- Um mapa rápido do que existe aqui:
--
--   admin_emails       quem é da operação, e se vê NF, MD ou os dois
--   profiles           uma ficha por pessoa que criou conta
--   empresas           as 213 empresas do grupo (razão social + CNPJ)
--   contas_bancarias   as contas de cada empresa (o "CC" do portal)
--   departamentos      lista para o formulário
--   boletos            o coração
--   boleto_eventos     o diário de tudo que aconteceu
-- ===========================================================================

create extension if not exists "pgcrypto";
create extension if not exists "unaccent";

-- --------------------------------------------------------------------------
-- Tipos com valores fixos. Melhor que texto livre: o banco recusa besteira.
-- --------------------------------------------------------------------------
do $$ begin
  create type tipo_documento as enum ('NF', 'MD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type status_boleto as enum ('pendente', 'associado', 'recusado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nivel_confianca as enum ('alta', 'media', 'baixa', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type papel_usuario as enum ('cliente', 'admin');
exception when duplicate_object then null; end $$;

-- NOVO: o que cada operador enxerga.
--   'NF'    -> só notas fiscais
--   'MD'    -> só medições
--   'ambos' -> as duas, com um alternador na tela
do $$ begin
  create type escopo_documento as enum ('NF', 'MD', 'ambos');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tipo_documento_empresa as enum ('cnpj', 'ein');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- admin_emails — a lista da operação
-- --------------------------------------------------------------------------
-- Quem está aqui vira operador automaticamente ao criar conta. Estar nesta
-- lista NÃO cria conta e NÃO dá acesso sozinho: a pessoa ainda precisa ativar
-- a conta pelo link que chega no e-mail dela. Ver docs/07-ACESSO-E-PAPEIS.md.
-- --------------------------------------------------------------------------
create table if not exists public.admin_emails (
  email            text primary key check (email = lower(email)),
  nome_sugerido    text,
  escopo           escopo_documento not null default 'NF',
  observacao       text,
  criado_em        timestamptz not null default now()
);

comment on table public.admin_emails is
  'E-mails que recebem papel de operador. O escopo diz se a pessoa vê NF, MD ou as duas.';

-- --------------------------------------------------------------------------
-- profiles — a ficha de cada pessoa
-- --------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null unique,
  nome             text not null default '',
  sobrenome        text not null default '',
  -- Coluna calculada: o operador vê nome e sobrenome numa coluna só.
  nome_completo    text generated always as (trim(nome || ' ' || sobrenome)) stored,
  papel            papel_usuario not null default 'cliente',
  escopo           escopo_documento not null default 'ambos',
  e_terceirizado   boolean not null default false,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create index if not exists idx_profiles_papel on public.profiles(papel);

-- --------------------------------------------------------------------------
-- empresas — as empresas do grupo
-- --------------------------------------------------------------------------
-- A chave é o documento (CNPJ com 14 dígitos, ou EIN com 9 para as empresas
-- dos Estados Unidos). Guardamos só dígitos: comparar "12.345.678/0001-90"
-- com "12345678000190" dá dor de cabeça, comparar dígito com dígito não.
--
-- chave_busca: o nome sem acento, sem "S.A." e com os algarismos romanos
-- virados em números. "ASSURUÁ 2 IV ENERGIA S.A." fica "ASSURUA 2 4 ENERGIA".
-- É isso que faz quem digita "assurua 2 4" encontrar a empresa.
-- --------------------------------------------------------------------------
create table if not exists public.empresas (
  documento          text primary key check (documento ~ '^[0-9]+$'),
  documento_tipo     tipo_documento_empresa not null default 'cnpj',
  razao_social       text not null,
  nomes_alternativos text[] not null default '{}',
  chave_busca        text not null default '',
  grupo_economico    text,
  codigo_interno     text,
  ativo              boolean not null default true,
  atualizado_em      timestamptz not null default now()
);

create index if not exists idx_empresas_chave_busca on public.empresas(chave_busca);
create index if not exists idx_empresas_ativo on public.empresas(ativo) where ativo;
create index if not exists idx_empresas_grupo on public.empresas(grupo_economico);

comment on column public.empresas.chave_busca is
  'Nome normalizado (sem acento, romanos em árabe) para a busca do formulário.';

-- --------------------------------------------------------------------------
-- contas_bancarias — o "CC" do portal
-- --------------------------------------------------------------------------
-- ATENÇÃO a este ponto, porque muda o entendimento do projeto:
-- na planilha da empresa, a coluna I ("CONTA") é a CONTA BANCÁRIA, não um
-- código de centro de custo. E uma empresa tem MUITAS contas — a maior tem 31.
--
-- Então a relação é: 1 empresa -> N contas. O formulário escolhe a empresa
-- (que vem do boleto) e depois a conta.
--
-- A conta vem com traço na planilha ("37700-7"). Guardamos as duas formas:
-- a original, para exibir igual à planilha, e só os dígitos, para procurar.
-- --------------------------------------------------------------------------
create table if not exists public.contas_bancarias (
  id                 uuid primary key default gen_random_uuid(),
  empresa_documento  text not null references public.empresas(documento) on delete cascade,
  conta              text not null,
  conta_digitos      text not null default '',
  banco              text,
  cod_banco          text,
  agencia            text,
  tipo_conta         text,
  ativo              boolean not null default true,
  atualizado_em      timestamptz not null default now(),
  unique (empresa_documento, conta)
);

create index if not exists idx_contas_empresa on public.contas_bancarias(empresa_documento);
create index if not exists idx_contas_conta on public.contas_bancarias(conta);
create index if not exists idx_contas_digitos on public.contas_bancarias(conta_digitos);
create index if not exists idx_contas_ativo on public.contas_bancarias(ativo) where ativo;

-- --------------------------------------------------------------------------
-- departamentos
-- --------------------------------------------------------------------------
create table if not exists public.departamentos (
  nome    text primary key,
  ativo   boolean not null default true,
  ordem   int not null default 100
);

-- --------------------------------------------------------------------------
-- boletos — o coração
-- --------------------------------------------------------------------------
create table if not exists public.boletos (
  id                     uuid primary key default gen_random_uuid(),
  numero_protocolo       bigint generated always as identity,

  -- Quem enviou
  solicitante_id         uuid not null references auth.users(id) on delete restrict,
  solicitante_nome       text not null,
  solicitante_sobrenome  text not null,
  solicitante_nome_completo text generated always as
                           (trim(solicitante_nome || ' ' || solicitante_sobrenome)) stored,
  solicitante_email      text not null,

  -- O documento
  tipo_documento         tipo_documento not null,
  numero_documento       text not null,
  documento_regularizado boolean not null default false,

  -- A empresa e a conta (as colunas "Und. neg / CNPJ" e "CC" da tela)
  cc                     text not null,
  conta_banco            text,
  conta_agencia          text,
  conta_tipo             text,
  unidade_negocio        text not null,
  unidade_cnpj           text not null,

  -- O fornecedor
  fornecedor_razao_social text not null,
  fornecedor_cnpj        text,

  -- O dinheiro
  valor                  numeric(14,2) not null check (valor > 0),
  vencimento             date not null,
  data_pagamento_desejada date,

  -- O que saiu de dentro do boleto
  codigo_barras          text check (codigo_barras is null or codigo_barras ~ '^[0-9]{44}$'),
  linha_digitavel        text check (linha_digitavel is null or linha_digitavel ~ '^[0-9]{47,48}$'),
  banco_emissor          text,
  extracao_confianca     nivel_confianca not null default 'manual',
  extracao_metodo        text,
  extracao_avisos        text[] not null default '{}',

  -- Classificação
  departamento           text not null,
  motivo_excecao         text,
  observacoes_cliente    text,
  observacoes_operador   text,

  -- O arquivo
  arquivo_caminho        text not null,
  arquivo_nome           text not null,
  arquivo_tamanho        bigint,
  arquivo_tipo           text,

  -- O andamento
  status                 status_boleto not null default 'pendente',
  data_envio             timestamptz not null default now(),
  data_associacao        timestamptz,
  associado_por          uuid references auth.users(id) on delete set null,
  associado_por_nome     text,
  associado_por_email    text,

  atualizado_em          timestamptz not null default now(),

  -- Um boleto associado obriga a ter quem e quando. Um pendente obriga a
  -- não ter. Isso impede estado pela metade, que é a origem de quase todo
  -- relatório que "não fecha".
  constraint boletos_associacao_coerente check (
    (status = 'associado' and data_associacao is not null and associado_por is not null)
    or (status <> 'associado' and data_associacao is null and associado_por is null)
  )
);

create index if not exists idx_boletos_status on public.boletos(status);
create index if not exists idx_boletos_tipo on public.boletos(tipo_documento);
create index if not exists idx_boletos_tipo_status on public.boletos(tipo_documento, status);
create index if not exists idx_boletos_solicitante on public.boletos(solicitante_id);
create index if not exists idx_boletos_data_envio on public.boletos(data_envio desc);
create index if not exists idx_boletos_vencimento on public.boletos(vencimento);
create index if not exists idx_boletos_cc on public.boletos(cc);
create index if not exists idx_boletos_cnpj on public.boletos(unidade_cnpj);

-- O MESMO boleto não pode entrar duas vezes. Mas um boleto recusado pode ser
-- reenviado corrigido — por isso o índice ignora os recusados.
create unique index if not exists idx_boletos_codbarras_unico
  on public.boletos(codigo_barras)
  where codigo_barras is not null and status in ('pendente', 'associado');

-- --------------------------------------------------------------------------
-- boleto_eventos — o diário
-- --------------------------------------------------------------------------
create table if not exists public.boleto_eventos (
  id            bigint generated always as identity primary key,
  boleto_id     uuid not null references public.boletos(id) on delete cascade,
  tipo          text not null,
  observacao    text,
  usuario_id    uuid references auth.users(id) on delete set null,
  usuario_email text,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_eventos_boleto on public.boleto_eventos(boleto_id, criado_em);
