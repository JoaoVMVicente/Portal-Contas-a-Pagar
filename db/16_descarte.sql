-- ===========================================================================
-- 16_descarte.sql — Descartar boleto que entrou por engano
-- ===========================================================================
-- NUMERAÇÃO: este é o arquivo que eu havia chamado de "11_descarte" quando o
-- entreguei. Você salvou as razões sociais como 11, então a minha sequência e a
-- sua divergiram e ele acabou nunca chegando. Como 16 ele entra no fim da fila,
-- sem colidir com nada. Rode depois de 01 a 14.
--
-- URGENTE PARA VOCÊ AGORA: este arquivo cria a coluna profiles.pode_descartar.
-- O portal a consulta ao montar a sessão, e como ela não existe, a consulta
-- inteira do perfil falha — e o código te trata como cliente. É por isso que
-- você perdeu a visão de operador.
--
-- POR QUE "DESCARTAR" E NÃO "APAGAR"
-- ----------------------------------
-- Apagar resolveria na hora, e é justamente o problema. Num sistema de contas
-- a pagar, "este boleto foi apagado" e "este boleto nunca existiu" ficam
-- indistinguíveis depois do fato. Se alguém perguntar por que o protocolo #7
-- não está entre o #6 e o #8, a resposta precisa existir em algum lugar.
--
-- Descartar mantém o registro, com motivo obrigatório e autor. O boleto sai da
-- fila, sai dos indicadores, e aparece só quando alguém procura por ele.
--
-- POR QUE NÃO GRAVEI UM E-MAIL NO CÓDIGO
-- --------------------------------------
-- O pedido foi "só eu terei acesso". A tentação é escrever o e-mail dentro da
-- função. Não fiz: no dia em que você delegar, sair de férias ou trocar de
-- função, alguém teria que mexer em código e rodar migração para uma decisão
-- que é administrativa. Virou permissão na tabela admin_emails, ao lado do
-- escopo — conceder ou tirar é um update de uma linha.
-- ===========================================================================

alter type status_boleto add value if not exists 'descartado';

alter table public.admin_emails
  add column if not exists pode_descartar boolean not null default false;

alter table public.profiles
  add column if not exists pode_descartar boolean not null default false;

comment on column public.admin_emails.pode_descartar is
  'Permite tirar boleto da fila por engano. Conceda a pouca gente.';

update public.admin_emails set pode_descartar = true
 where email = 'joao.vicente@srna.co';

-- ---------------------------------------------------------------------------
-- A permissão acompanha o perfil
-- ---------------------------------------------------------------------------
create or replace function public.fn_criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_admin     public.admin_emails;
  v_nome      text;
  v_sobrenome text;
  v_email     text := lower(new.email);
begin
  select * into v_admin from public.admin_emails where email = v_email;

  v_nome      := nullif(trim(coalesce(new.raw_user_meta_data->>'nome', '')), '');
  v_sobrenome := nullif(trim(coalesce(new.raw_user_meta_data->>'sobrenome', '')), '');

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

  insert into public.profiles
    (id, email, nome, sobrenome, papel, escopo, e_terceirizado, pode_descartar)
  values (
    new.id, v_email, coalesce(v_nome, ''), coalesce(v_sobrenome, ''),
    case when v_admin.email is not null then 'admin' else 'cliente' end::papel_usuario,
    coalesce(v_admin.escopo, 'ambos')::escopo_documento,
    public.eh_terceirizado(v_email),
    coalesce(v_admin.pode_descartar, false)
  )
  on conflict (id) do nothing;

  return new;
end $$;

create or replace function public.fn_sincronizar_papel_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    update public.profiles
       set papel = 'admin', escopo = new.escopo, pode_descartar = new.pode_descartar
     where email = new.email;
  end if;

  if tg_op = 'DELETE' then
    update public.profiles
       set papel = 'cliente', escopo = 'ambos', pode_descartar = false
     where email = old.email;
  end if;

  return null;
end $$;

update public.profiles p
   set pode_descartar = a.pode_descartar
  from public.admin_emails a
 where a.email = p.email;

-- ---------------------------------------------------------------------------
-- A pergunta que a tela faz
-- ---------------------------------------------------------------------------
create or replace function public.eu_posso_descartar()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select pode_descartar from public.profiles where id = auth.uid()), false);
$$;

-- Ninguém pode se conceder a permissão editando o próprio perfil.
drop policy if exists "perfil: edito o meu nome" on public.profiles;
create policy "perfil: edito o meu nome" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and papel          = (select papel          from public.profiles where id = auth.uid())
    and escopo         = (select escopo         from public.profiles where id = auth.uid())
    and pode_descartar = (select pode_descartar from public.profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Descartar e restaurar
-- ---------------------------------------------------------------------------
create or replace function public.descartar_boleto(p_boleto_id uuid, p_motivo text)
returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto public.boletos;
  v_perfil public.profiles;
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: esta ação é da equipe de operação.';
  end if;
  if not public.eu_posso_descartar() then
    raise exception 'SEM_PERMISSAO_DESCARTE: você não tem permissão para descartar boletos.';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
    raise exception 'MOTIVO_OBRIGATORIO: escreva por que este boleto está sendo descartado.';
  end if;

  select * into v_perfil from public.profiles where id = auth.uid();
  select * into v_boleto from public.boletos where id = p_boleto_id for update;

  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;
  if not public.posso_ver_tipo(v_boleto.tipo_documento) then
    raise exception 'FORA_DO_ESCOPO: este boleto não é do tipo que você trabalha.';
  end if;

  -- Descartar algo já associado seria apagar um registro de pagamento em um
  -- passo. Exigimos desfazer a associação antes: duas ações deliberadas em vez
  -- de uma, porque o custo do erro aqui é alto.
  if v_boleto.status = 'associado' then
    raise exception 'ASSOCIADO_PRIMEIRO: desfaça a associação antes de descartar.';
  end if;
  if v_boleto.status = 'descartado' then
    raise exception 'JA_DESCARTADO: este boleto já foi descartado.';
  end if;

  update public.boletos set
    status = 'descartado', data_associacao = null, associado_por = null,
    associado_por_nome = null, associado_por_email = null,
    observacoes_operador = btrim(p_motivo), visto_pelo_solicitante_em = null
  where id = p_boleto_id
  returning * into v_boleto;

  insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
  values (p_boleto_id, 'descartado', btrim(p_motivo), auth.uid(), v_perfil.email);

  return v_boleto;
end $$;

create or replace function public.restaurar_boleto(p_boleto_id uuid, p_observacao text default null)
returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto public.boletos;
  v_perfil public.profiles;
begin
  if not public.eu_posso_descartar() then
    raise exception 'SEM_PERMISSAO_DESCARTE: só quem pode descartar pode restaurar.';
  end if;

  select * into v_perfil from public.profiles where id = auth.uid();
  select * into v_boleto from public.boletos where id = p_boleto_id for update;

  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;
  if v_boleto.status <> 'descartado' then
    raise exception 'NAO_ESTA_DESCARTADO: este boleto não está descartado.';
  end if;

  update public.boletos set
    status = 'pendente',
    observacoes_operador = coalesce(p_observacao, 'descarte desfeito'),
    visto_pelo_solicitante_em = null
  where id = p_boleto_id
  returning * into v_boleto;

  insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
  values (p_boleto_id, 'restaurado', coalesce(p_observacao, 'descarte desfeito'),
          auth.uid(), v_perfil.email);

  return v_boleto;
end $$;

-- ---------------------------------------------------------------------------
-- Descartado libera o código de barras
-- ---------------------------------------------------------------------------
-- O motivo mais comum de descartar é "entrou errado", e a pessoa precisa poder
-- mandar o certo.
drop index if exists public.idx_boletos_codbarras_unico;
create unique index idx_boletos_codbarras_unico
  on public.boletos(codigo_barras)
  where codigo_barras is not null and status in ('pendente', 'associado');

-- ---------------------------------------------------------------------------
-- Os indicadores ignoram descartados
-- ---------------------------------------------------------------------------
-- Se entrassem no total e no valor, os quatro cartões passariam a mentir: o
-- dinheiro de um boleto descartado não existe.
--
-- O DROP antes é obrigatório: a função ganhou uma coluna no retorno, e o
-- Postgres não permite trocar o formato de retorno com "create or replace".
drop function if exists public.kpis_boletos(tipo_documento);

create or replace function public.kpis_boletos(p_tipo tipo_documento default null)
returns table (
  total_boletos bigint,
  valor_total   numeric,
  pendentes     bigint,
  associados    bigint,
  recusados     bigint,
  descartados   bigint
) language sql stable security invoker set search_path = public as $$
  select
    count(*) filter (where status <> 'descartado')::bigint,
    coalesce(sum(valor) filter (where status <> 'descartado'), 0)::numeric,
    count(*) filter (where status = 'pendente')::bigint,
    count(*) filter (where status = 'associado')::bigint,
    count(*) filter (where status = 'recusado')::bigint,
    count(*) filter (where status = 'descartado')::bigint
  from public.boletos
  where (p_tipo is null or tipo_documento = p_tipo);
$$;

grant execute on function public.eu_posso_descartar()         to authenticated;
grant execute on function public.descartar_boleto(uuid, text) to authenticated;
grant execute on function public.restaurar_boleto(uuid, text) to authenticated;
grant execute on function public.kpis_boletos(tipo_documento) to authenticated;

-- ===========================================================================
-- CONFERÊNCIA — o que destrava a sua visão de operador
-- ===========================================================================
--   select email, papel, escopo, pode_descartar, departamento
--     from public.profiles where email = 'joao.vicente@srna.co';
--
--   -- deve trazer seis colunas, incluindo descartados:
--   select * from public.kpis_boletos();
--
-- CONCEDER OU TIRAR A PERMISSÃO DE DESCARTE
--   update public.admin_emails set pode_descartar = true  where email = '...';
--   update public.admin_emails set pode_descartar = false where email = '...';
