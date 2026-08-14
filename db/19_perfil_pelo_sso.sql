-- ===========================================================================
-- 19_perfil_pelo_sso.sql — O perfil nasce dos dados do Entra ID
-- ===========================================================================
-- Rode no projeto NOVO, depois de todas as outras.
--
-- POR QUE
-- -------
-- O gatilho que cria o perfil foi escrito para o login por e-mail e senha, onde
-- o próprio portal mandava `nome` e `sobrenome` nos metadados. Com SSO isso
-- muda: quem manda os dados é a Microsoft, e os campos têm outros nomes.
--
-- O que o Entra ID entrega, com os escopos "openid profile email":
--
--   given_name    João
--   family_name   Vicente
--   full_name     João Vicente
--   name          João Vicente
--   email         joao.vicente@srna.co
--   department    Financeiro          (só se o claim opcional foi configurado)
--
-- Sem este ajuste o perfil ainda nasce, mas com o nome deduzido do e-mail —
-- "Joao" e "Vicente" a partir de joao.vicente. Funciona, e é pior: perde acento
-- e erra nomes compostos. "maria.da.silva" viraria "Maria" + "Da Silva".
--
-- A ordem de tentativa vai do mais confiável ao menos:
--   1. given_name e family_name, separados pela Microsoft
--   2. full_name ou name, quebrados no primeiro espaço
--   3. o e-mail, como sempre foi
-- ===========================================================================

create or replace function public.fn_criar_perfil_novo_usuario()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  v_admin      public.admin_emails;
  v_email      text := lower(new.email);
  v_meta       jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_nome       text;
  v_sobrenome  text;
  v_completo   text;
  v_depto      text;
begin
  select * into v_admin from public.admin_emails where email = v_email;

  -- 1. O que o Entra ID separou para nós.
  v_nome      := nullif(btrim(coalesce(v_meta->>'given_name',  v_meta->>'nome',      '')), '');
  v_sobrenome := nullif(btrim(coalesce(v_meta->>'family_name', v_meta->>'sobrenome', '')), '');

  -- 2. Só o nome completo? Quebramos no primeiro espaço. O resto é sobrenome,
  --    para não perder "da Silva Santos".
  if v_nome is null then
    v_completo := nullif(btrim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), '');
    if v_completo is not null then
      v_nome      := split_part(v_completo, ' ', 1);
      v_sobrenome := nullif(btrim(substr(v_completo, length(split_part(v_completo, ' ', 1)) + 1)), '');
    end if;
  end if;

  -- 3. Último recurso: deduzir do e-mail, como antes do SSO.
  if v_nome is null then
    declare
      v_partes text[];
      v_inicio int := 1;
    begin
      v_partes := string_to_array(split_part(v_email, '@', 1), '.');
      -- "sit.pedro.moreira" começa com um prefixo curto de sistema.
      if array_length(v_partes, 1) >= 3 and length(v_partes[1]) <= 3 then
        v_inicio := 2;
      end if;
      v_nome := initcap(v_partes[v_inicio]);
      if array_length(v_partes, 1) >= v_inicio + 1 then
        v_sobrenome := initcap(array_to_string(v_partes[v_inicio + 1 : array_length(v_partes, 1)], ' '));
      end if;
    end;
  end if;

  -- O departamento, se o claim opcional foi configurado no Entra.
  --
  -- Só aceitamos se bater com a lista (db/15). Departamento que a Microsoft
  -- chama de um jeito e a tabela de outro entraria como valor solto e
  -- quebraria o agrupamento — melhor deixar nulo e a pessoa escolher uma vez.
  v_depto := nullif(btrim(coalesce(v_meta->>'department', '')), '');
  if v_depto is not null then
    select d.nome into v_depto
      from public.departamentos d
     where d.ativo
       and upper(unaccent(d.nome)) = upper(unaccent(v_depto))
     limit 1;
  end if;

  insert into public.profiles
    (id, email, nome, sobrenome, papel, escopo, e_terceirizado, pode_descartar, departamento)
  values (
    new.id, v_email,
    coalesce(v_nome, ''), coalesce(v_sobrenome, ''),
    case when v_admin.email is not null then 'admin' else 'cliente' end::papel_usuario,
    coalesce(v_admin.escopo, 'ambos')::escopo_documento,
    public.eh_terceirizado(v_email),
    coalesce(v_admin.pode_descartar, false),
    v_depto
  )
  on conflict (id) do nothing;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Quem já entrou antes desta migração continua com o nome deduzido do e-mail
-- ---------------------------------------------------------------------------
-- O gatilho só roda na criação. Esta função permite atualizar um perfil já
-- existente com os dados que o Entra mandou no último login.
create or replace function public.sincronizar_meu_perfil_do_sso()
returns public.profiles
language plpgsql security definer set search_path = public, auth as $$
declare
  v_meta      jsonb;
  v_nome      text;
  v_sobrenome text;
  v_completo  text;
  v_depto     text;
  v_perfil    public.profiles;
begin
  select coalesce(raw_user_meta_data, '{}'::jsonb) into v_meta
    from auth.users where id = auth.uid();

  if v_meta is null then
    raise exception 'SEM_USUARIO: não achei sua conta.';
  end if;

  v_nome      := nullif(btrim(coalesce(v_meta->>'given_name', '')), '');
  v_sobrenome := nullif(btrim(coalesce(v_meta->>'family_name', '')), '');

  if v_nome is null then
    v_completo := nullif(btrim(coalesce(v_meta->>'full_name', v_meta->>'name', '')), '');
    if v_completo is not null then
      v_nome      := split_part(v_completo, ' ', 1);
      v_sobrenome := nullif(btrim(substr(v_completo, length(split_part(v_completo, ' ', 1)) + 1)), '');
    end if;
  end if;

  v_depto := nullif(btrim(coalesce(v_meta->>'department', '')), '');
  if v_depto is not null then
    select d.nome into v_depto
      from public.departamentos d
     where d.ativo and upper(unaccent(d.nome)) = upper(unaccent(v_depto))
     limit 1;
  end if;

  update public.profiles set
    nome         = coalesce(v_nome, nome),
    sobrenome    = coalesce(v_sobrenome, sobrenome),
    departamento = coalesce(v_depto, departamento)
  where id = auth.uid()
  returning * into v_perfil;

  return v_perfil;
end $$;

grant execute on function public.sincronizar_meu_perfil_do_sso() to authenticated;

-- ===========================================================================
-- CONFERÊNCIA — depois de entrar no portal pela primeira vez com SSO
-- ===========================================================================
--   -- o que a Microsoft mandou:
--   select email, raw_user_meta_data from auth.users;
--
--   -- e como ficou o perfil:
--   select email, nome, sobrenome, papel, escopo, departamento from public.profiles;
--
--   -- se o nome vier deduzido do e-mail, chame uma vez para corrigir:
--   select public.sincronizar_meu_perfil_do_sso();
