-- ===========================================================================
-- 02_functions_triggers.sql — As automações
-- ===========================================================================

-- --------------------------------------------------------------------------
-- Carimbo de "atualizado_em"
-- --------------------------------------------------------------------------
create or replace function public.fn_atualizar_timestamp()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

drop trigger if exists trg_ts_profiles on public.profiles;
create trigger trg_ts_profiles before update on public.profiles
  for each row execute function public.fn_atualizar_timestamp();

drop trigger if exists trg_ts_boletos on public.boletos;
create trigger trg_ts_boletos before update on public.boletos
  for each row execute function public.fn_atualizar_timestamp();

drop trigger if exists trg_ts_empresas on public.empresas;
create trigger trg_ts_empresas before update on public.empresas
  for each row execute function public.fn_atualizar_timestamp();

drop trigger if exists trg_ts_contas on public.contas_bancarias;
create trigger trg_ts_contas before update on public.contas_bancarias
  for each row execute function public.fn_atualizar_timestamp();

-- --------------------------------------------------------------------------
-- Quem sou eu? — usadas pelas políticas de segurança
-- --------------------------------------------------------------------------
-- "security definer" = a função roda com os poderes de quem a criou. Isso é
-- necessário aqui: a política que protege a tabela profiles não pode ler a
-- própria tabela profiles para decidir (daria uma volta infinita).
-- --------------------------------------------------------------------------
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and papel = 'admin'
  );
$$;

create or replace function public.meu_papel()
returns papel_usuario language sql stable security definer set search_path = public as $$
  select coalesce((select papel from public.profiles where id = auth.uid()), 'cliente'::papel_usuario);
$$;

-- NOVO: o escopo de quem está logado. 'ambos' para cliente (o cliente vê os
-- próprios boletos, sejam NF ou MD).
create or replace function public.meu_escopo()
returns escopo_documento language sql stable security definer set search_path = public as $$
  select coalesce((select escopo from public.profiles where id = auth.uid()), 'ambos'::escopo_documento);
$$;

-- Diz se eu posso ver um tipo de documento. É a regra usada em três lugares:
-- na política de leitura, nos KPIs e nas funções de associar/recusar.
create or replace function public.posso_ver_tipo(p_tipo tipo_documento)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.meu_escopo()
    when 'ambos' then true
    when 'NF'    then p_tipo = 'NF'
    when 'MD'    then p_tipo = 'MD'
    else false
  end;
$$;

-- --------------------------------------------------------------------------
-- Domínios liberados
-- --------------------------------------------------------------------------
-- A empresa tem dois domínios: @srna.co para quem é do quadro e @ext.srna.co
-- para terceirizados. Os dois entram. Qualquer outro, não.
--
-- Deixamos isso numa função em vez de espalhar o texto '@srna.co' pelo código:
-- se um dia entrar um terceiro domínio, muda em um lugar só.
-- --------------------------------------------------------------------------
create or replace function public.dominio_liberado(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email, '')) ~ '@(srna\.co|ext\.srna\.co)$';
$$;

create or replace function public.eh_terceirizado(p_email text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_email, '')) ~ '@ext\.srna\.co$';
$$;

-- Bloqueia na raiz: nem chega a existir usuário de fora.
create or replace function public.fn_bloquear_dominio_externo()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.dominio_liberado(new.email) then
    raise exception 'Somente e-mails @srna.co ou @ext.srna.co podem acessar este portal.';
  end if;
  return new;
end $$;

drop trigger if exists trg_bloquear_dominio_externo on auth.users;
create trigger trg_bloquear_dominio_externo
  before insert on auth.users
  for each row execute function public.fn_bloquear_dominio_externo();

-- --------------------------------------------------------------------------
-- Nasce um usuário -> nasce a ficha dele
-- --------------------------------------------------------------------------
-- O papel e o escopo saem da tabela admin_emails. Quem não está lá é cliente.
-- --------------------------------------------------------------------------
create or replace function public.fn_criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_admin      public.admin_emails;
  v_nome       text;
  v_sobrenome  text;
  v_email      text := lower(new.email);
begin
  select * into v_admin from public.admin_emails where email = v_email;

  v_nome      := nullif(trim(coalesce(new.raw_user_meta_data->>'nome', '')), '');
  v_sobrenome := nullif(trim(coalesce(new.raw_user_meta_data->>'sobrenome', '')), '');

  -- Sem nome informado, derivamos do e-mail. "sit.pedro.moreira@ext.srna.co"
  -- vira "Pedro Moreira": o primeiro pedaço é a sigla da empresa terceirizada,
  -- então pulamos pedaços de até 3 letras no começo.
  if v_nome is null then
    declare
      v_partes text[];
      v_inicio int := 1;
    begin
      v_partes := string_to_array(split_part(v_email, '@', 1), '.');
      if array_length(v_partes, 1) >= 3 and length(v_partes[1]) <= 3 then
        v_inicio := 2;
      end if;
      v_nome := initcap(v_partes[v_inicio]);
      if array_length(v_partes, 1) >= v_inicio + 1 then
        v_sobrenome := initcap(array_to_string(v_partes[v_inicio + 1 : array_length(v_partes,1)], ' '));
      end if;
    end;
  end if;

  insert into public.profiles (id, email, nome, sobrenome, papel, escopo, e_terceirizado)
  values (
    new.id,
    v_email,
    coalesce(v_nome, ''),
    coalesce(v_sobrenome, ''),
    case when v_admin.email is not null then 'admin' else 'cliente' end::papel_usuario,
    coalesce(v_admin.escopo, 'ambos')::escopo_documento,
    public.eh_terceirizado(v_email)
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists trg_criar_perfil on auth.users;
create trigger trg_criar_perfil
  after insert on auth.users
  for each row execute function public.fn_criar_perfil_novo_usuario();

-- --------------------------------------------------------------------------
-- Mexeu na lista da operação -> os papéis se ajustam na hora
-- --------------------------------------------------------------------------
create or replace function public.fn_sincronizar_papel_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles
       set papel = 'admin', escopo = new.escopo
     where email = new.email;
  end if;

  if tg_op = 'DELETE' then
    update public.profiles
       set papel = 'cliente', escopo = 'ambos'
     where email = old.email;
  end if;

  return null;
end $$;

drop trigger if exists trg_sincronizar_admin on public.admin_emails;
create trigger trg_sincronizar_admin
  after insert or update or delete on public.admin_emails
  for each row execute function public.fn_sincronizar_papel_admin();

-- --------------------------------------------------------------------------
-- O diário
-- --------------------------------------------------------------------------
create or replace function public.fn_registrar_evento_boleto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce((select email from public.profiles where id = auth.uid()), 'sistema');
begin
  if tg_op = 'INSERT' then
    insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
    values (new.id, 'criado',
            format('%s-%s · %s · R$ %s', new.tipo_documento, new.numero_documento,
                   new.fornecedor_razao_social, new.valor),
            auth.uid(), v_email);
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
    values (new.id, 'status:' || new.status,
            coalesce(new.observacoes_operador, format('de %s para %s', old.status, new.status)),
            auth.uid(), v_email);
  end if;

  return new;
end $$;

drop trigger if exists trg_evento_boleto_insert on public.boletos;
create trigger trg_evento_boleto_insert after insert on public.boletos
  for each row execute function public.fn_registrar_evento_boleto();

drop trigger if exists trg_evento_boleto_update on public.boletos;
create trigger trg_evento_boleto_update after update on public.boletos
  for each row execute function public.fn_registrar_evento_boleto();

-- --------------------------------------------------------------------------
-- A conta escolhida precisa existir de verdade
-- --------------------------------------------------------------------------
-- Isto fecha a porta para alguém mandar um par empresa+conta inventado
-- mexendo no JavaScript do navegador.
-- --------------------------------------------------------------------------
create or replace function public.fn_validar_conta_do_boleto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conta public.contas_bancarias;
  v_empresa public.empresas;
begin
  select c.* into v_conta
    from public.contas_bancarias c
   where c.empresa_documento = regexp_replace(new.unidade_cnpj, '\D', '', 'g')
     and c.conta = new.cc
     and c.ativo;

  if v_conta.id is null then
    raise exception 'CONTA_INVALIDA: a conta % não pertence à empresa informada, ou está encerrada.', new.cc;
  end if;

  select e.* into v_empresa
    from public.empresas e
   where e.documento = v_conta.empresa_documento;

  -- Preenchemos os campos de contexto a partir da fonte da verdade, em vez de
  -- confiar no que veio da tela.
  new.unidade_cnpj    := v_empresa.documento;
  new.unidade_negocio := v_empresa.razao_social;
  new.conta_banco     := v_conta.banco;
  new.conta_agencia   := v_conta.agencia;
  new.conta_tipo      := v_conta.tipo_conta;

  return new;
end $$;

drop trigger if exists trg_validar_conta on public.boletos;
create trigger trg_validar_conta
  before insert on public.boletos
  for each row execute function public.fn_validar_conta_do_boleto();

-- ===========================================================================
-- As funções que as telas chamam
-- ===========================================================================

-- ------------------------------------------------------- os quatro cartões --
-- Recebe o tipo para respeitar o escopo de quem está olhando. Passar null
-- significa "o que eu tiver direito de ver".
create or replace function public.kpis_boletos(p_tipo tipo_documento default null)
returns table (
  total_boletos bigint,
  valor_total   numeric,
  pendentes     bigint,
  associados    bigint,
  recusados     bigint
) language sql stable security invoker set search_path = public as $$
  select
    count(*)::bigint,
    coalesce(sum(valor), 0)::numeric,
    count(*) filter (where status = 'pendente')::bigint,
    count(*) filter (where status = 'associado')::bigint,
    count(*) filter (where status = 'recusado')::bigint
  from public.boletos
  where (p_tipo is null or tipo_documento = p_tipo);
$$;

-- --------------------------------------------------------------- associar --
create or replace function public.associar_boleto(
  p_boleto_id uuid,
  p_observacao text default null
) returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto public.boletos;
  v_perfil public.profiles;
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: só a equipe de operação pode associar boletos.';
  end if;

  select * into v_perfil from public.profiles where id = auth.uid();
  select * into v_boleto from public.boletos where id = p_boleto_id for update;

  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;

  if not public.posso_ver_tipo(v_boleto.tipo_documento) then
    raise exception 'FORA_DO_ESCOPO: este boleto é do tipo % e você trabalha com %.',
      v_boleto.tipo_documento, v_perfil.escopo;
  end if;

  if v_boleto.status = 'associado' then
    raise exception 'JA_ASSOCIADO: este boleto já foi associado por % em %.',
      coalesce(v_boleto.associado_por_nome, 'alguém'),
      to_char(v_boleto.data_associacao, 'DD/MM/YYYY HH24:MI');
  end if;

  update public.boletos set
    status               = 'associado',
    data_associacao      = now(),
    associado_por        = auth.uid(),
    associado_por_nome   = v_perfil.nome_completo,
    associado_por_email  = v_perfil.email,
    observacoes_operador = coalesce(p_observacao, observacoes_operador)
  where id = p_boleto_id
  returning * into v_boleto;

  return v_boleto;
end $$;

-- ---------------------------------------------------------------- recusar --
create or replace function public.recusar_boleto(
  p_boleto_id uuid,
  p_motivo text
) returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto public.boletos;
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: só a equipe de operação pode recusar boletos.';
  end if;

  if p_motivo is null or length(trim(p_motivo)) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO: escreva o motivo. Quem enviou o boleto vai ler isso.';
  end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;

  if not public.posso_ver_tipo(v_boleto.tipo_documento) then
    raise exception 'FORA_DO_ESCOPO: este boleto não é do tipo que você trabalha.';
  end if;

  update public.boletos set
    status               = 'recusado',
    data_associacao      = null,
    associado_por        = null,
    associado_por_nome   = null,
    associado_por_email  = null,
    observacoes_operador = trim(p_motivo)
  where id = p_boleto_id
  returning * into v_boleto;

  return v_boleto;
end $$;

-- ---------------------------------------------------------------- reabrir --
create or replace function public.reabrir_boleto(
  p_boleto_id uuid,
  p_observacao text default 'Associação desfeita pelo operador'
) returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto public.boletos;
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: só a equipe de operação pode reabrir boletos.';
  end if;

  select * into v_boleto from public.boletos where id = p_boleto_id for update;
  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;

  if not public.posso_ver_tipo(v_boleto.tipo_documento) then
    raise exception 'FORA_DO_ESCOPO: este boleto não é do tipo que você trabalha.';
  end if;

  update public.boletos set
    status               = 'pendente',
    data_associacao      = null,
    associado_por        = null,
    associado_por_nome   = null,
    associado_por_email  = null,
    observacoes_operador = p_observacao
  where id = p_boleto_id
  returning * into v_boleto;

  return v_boleto;
end $$;

-- ===========================================================================
-- Consultas de empresas e contas
-- ===========================================================================

-- As contas de uma empresa. É o que o formulário chama depois de identificar
-- a empresa a partir do boleto.
create or replace function public.contas_da_empresa(p_documento text)
returns table (
  conta text, banco text, cod_banco text, agencia text, tipo_conta text
) language sql stable security invoker set search_path = public as $$
  select c.conta, c.banco, c.cod_banco, c.agencia, c.tipo_conta
    from public.contas_bancarias c
   where c.empresa_documento = regexp_replace(coalesce(p_documento, ''), '\D', '', 'g')
     and c.ativo
   order by c.tipo_conta nulls last, c.banco, c.conta;
$$;

-- A empresa dona de uma conta. É o caminho inverso: digitou a conta, aparece
-- a empresa. Aceita com ou sem o traço.
create or replace function public.empresa_da_conta(p_conta text)
returns table (
  documento text, razao_social text, grupo_economico text, conta text, banco text, agencia text, tipo_conta text
) language sql stable security invoker set search_path = public as $$
  select e.documento, e.razao_social, e.grupo_economico,
         c.conta, c.banco, c.agencia, c.tipo_conta
    from public.contas_bancarias c
    join public.empresas e on e.documento = c.empresa_documento
   where c.ativo and e.ativo
     and (c.conta = trim(coalesce(p_conta, ''))
          or c.conta_digitos = regexp_replace(coalesce(p_conta, ''), '\D', '', 'g'))
   order by e.razao_social;
$$;

-- Busca de empresa por CNPJ ou por nome. O nome usa a chave normalizada, então
-- "assurua 2 4" encontra "ASSURUÁ 2 IV ENERGIA S.A.".
create or replace function public.buscar_empresas(p_termo text, p_limite int default 30)
returns table (
  documento text, razao_social text, grupo_economico text, qtd_contas bigint
) language sql stable security invoker set search_path = public as $$
  with termo as (
    select
      regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as so_digitos,
      upper(unaccent(coalesce(p_termo, ''))) as texto
  )
  select e.documento, e.razao_social, e.grupo_economico,
         (select count(*) from public.contas_bancarias c
           where c.empresa_documento = e.documento and c.ativo)::bigint
    from public.empresas e, termo t
   where e.ativo
     and (
       (length(t.so_digitos) >= 3 and e.documento like '%' || t.so_digitos || '%')
       or (length(t.texto) >= 2 and (
             e.chave_busca like '%' || t.texto || '%'
             or upper(unaccent(e.razao_social)) like '%' || t.texto || '%'
          ))
     )
   order by e.razao_social
   limit greatest(1, least(p_limite, 100));
$$;
