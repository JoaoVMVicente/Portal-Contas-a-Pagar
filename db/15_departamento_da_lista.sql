-- ===========================================================================
-- 15_departamento_da_lista.sql — Departamento escolhido, não digitado
-- ===========================================================================
-- Rode DEPOIS do 14.
--
-- O QUE MUDA
-- ----------
-- O db/14 deixou o departamento livre para digitar. Texto livre em campo que
-- vira filtro e agrupamento produz "Financeiro", "financeiro", "Fin." e
-- "Financeiro/Tesouraria" — quatro departamentos onde existe um.
--
-- Agora a pessoa escolhe de uma lista: a tabela departamentos, que já existe
-- desde o 01 com onze entradas.
--
-- QUANDO A LISTA OFICIAL CHEGAR
-- -----------------------------
-- Não muda código nenhum. É trocar o conteúdo da tabela:
--
--   update public.departamentos set ativo = false;
--   insert into public.departamentos (nome, ativo)
--   values ('Nome que veio de People', true), ('Outro', true)
--   on conflict (nome) do update set ativo = true;
--
-- Quem já escolheu um departamento que sair da lista continua com ele: a
-- validação vale para escolhas NOVAS, então ninguém trava no dia da troca.
-- Para achar essas pessoas depois:
--
--   select p.email, p.departamento
--     from public.profiles p
--    where p.departamento is not null
--      and not exists (select 1 from public.departamentos d
--                       where d.nome = p.departamento and d.ativo);
-- ===========================================================================

create or replace function public.definir_meu_departamento(p_departamento text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_limpo   text := regexp_replace(btrim(coalesce(p_departamento, '')), '\s+', ' ', 'g');
  v_oficial text;
  v_perfil  public.profiles;
begin
  if v_limpo = '' then
    raise exception 'DEPARTAMENTO_VAZIO: escolha o seu departamento.';
  end if;

  -- Casamos sem diferenciar maiúsculas nem acentos, mas GRAVAMOS a grafia
  -- oficial da tabela. Assim "financeiro" vira "Financeiro" e o agrupamento
  -- por departamento não se fragmenta.
  select d.nome into v_oficial
    from public.departamentos d
   where d.ativo
     and upper(unaccent(d.nome)) = upper(unaccent(v_limpo))
   limit 1;

  if v_oficial is null then
    raise exception 'DEPARTAMENTO_INVALIDO: "%" não está na lista de departamentos.', v_limpo;
  end if;

  update public.profiles
     set departamento = v_oficial
   where id = auth.uid()
  returning * into v_perfil;

  if v_perfil.id is null then
    raise exception 'SEM_PERFIL: sua conta não tem perfil no portal.';
  end if;

  return v_perfil;
end $$;

-- ---------------------------------------------------------------------------
-- A lista para a tela montar o seletor
-- ---------------------------------------------------------------------------
-- Substitui a departamentos_sugeridos do db/14, que misturava a lista oficial
-- com o que as pessoas haviam digitado. Agora só a lista vale.
drop function if exists public.departamentos_sugeridos();

create or replace function public.departamentos_sugeridos()
returns table (nome text, quantas bigint)
language sql stable security definer set search_path = public as $$
  select d.nome,
         (select count(*) from public.profiles p where p.departamento = d.nome)::bigint
    from public.departamentos d
   where d.ativo
   order by d.nome;
$$;

grant execute on function public.definir_meu_departamento(text) to authenticated;
grant execute on function public.departamentos_sugeridos()      to authenticated;

-- Alinha a grafia de quem herdou departamento do último boleto (db/14).
update public.profiles p
   set departamento = d.nome
  from public.departamentos d
 where p.departamento is not null
   and upper(unaccent(p.departamento)) = upper(unaccent(d.nome))
   and p.departamento <> d.nome;

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   select * from public.departamentos_sugeridos();
--   select public.definir_meu_departamento('Departamento Inventado');  -- recusa
--   select public.definir_meu_departamento('financeiro');              -- aceita
