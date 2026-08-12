-- ===========================================================================
-- 14_departamento_no_perfil.sql — O departamento é da pessoa, não do boleto
-- ===========================================================================
-- Rode DEPOIS de 01 a 13.
--
-- O QUE MUDA
-- ----------
-- Até agora o departamento era escolhido a cada envio, num seletor. Mas
-- departamento não é atributo do boleto: é de quem envia. Alguém do Financeiro
-- manda boleto do Financeiro, sempre. Perguntar a cada envio é pedir a mesma
-- resposta cem vezes — e abrir espaço para responder diferente por engano.
--
-- Agora ele é informado UMA VEZ, junto com a senha no primeiro acesso, e fica
-- guardado no perfil. Na hora de anexar boleto, aparece só para conferência.
--
-- POR QUE CARIMBAR TAMBÉM AQUI
-- ----------------------------
-- Mesma lógica do db/13: o gatilho escreve o departamento a partir do perfil e
-- ignora o que o navegador mandou. Se fosse só "campo somente leitura na tela",
-- a trava seria de JavaScript — e JavaScript de tela é sugestão, não regra.
--
-- A operação continua podendo corrigir depois, pela função completar_boleto.
-- O carimbo vale só na entrada.
-- ===========================================================================

begin;

alter table public.profiles
  add column if not exists departamento text;

comment on column public.profiles.departamento is
  'Departamento de quem envia. Informado uma vez, no primeiro acesso.';

-- ---------------------------------------------------------------------------
-- Quem já tem conta herda o departamento do último boleto que enviou
-- ---------------------------------------------------------------------------
-- Evita pedir de novo a quem já usou o portal. Se a pessoa nunca enviou nada,
-- fica nulo e a tela pergunta na primeira vez.
update public.profiles p
   set departamento = u.departamento
  from (
    select distinct on (solicitante_id) solicitante_id, departamento
      from public.boletos
     where departamento is not null
     order by solicitante_id, data_envio desc
  ) u
 where u.solicitante_id = p.id
   and p.departamento is null;

-- ---------------------------------------------------------------------------
-- O carimbo
-- ---------------------------------------------------------------------------
create or replace function public.fn_carimbar_solicitante()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_perfil    public.profiles;
  v_informado text;
begin
  select * into v_perfil from public.profiles where id = auth.uid();

  if v_perfil.id is null then
    raise exception 'SEM_PERFIL: sua conta não tem perfil no portal. Entre de novo.';
  end if;

  if v_perfil.departamento is null or btrim(v_perfil.departamento) = '' then
    raise exception 'SEM_DEPARTAMENTO: informe o seu departamento antes de enviar boletos.';
  end if;

  -- Guardamos a divergência ANTES de sobrescrever. É o registro da tentativa.
  if new.solicitante_email is not null
     and lower(btrim(new.solicitante_email)) <> lower(v_perfil.email) then
    v_informado := format(
      'informou %s (%s %s), mas está logado como %s',
      btrim(new.solicitante_email),
      coalesce(new.solicitante_nome, ''),
      coalesce(new.solicitante_sobrenome, ''),
      v_perfil.email
    );
  end if;

  new.solicitante_id         := auth.uid();
  new.solicitante_email      := v_perfil.email;
  new.solicitante_nome       := coalesce(nullif(btrim(v_perfil.nome), ''),
                                         split_part(v_perfil.email, '@', 1));
  new.solicitante_sobrenome  := coalesce(btrim(v_perfil.sobrenome), '');
  new.solicitante_informado  := v_informado;
  new.departamento           := btrim(v_perfil.departamento);

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Guardar o departamento do próprio perfil
-- ---------------------------------------------------------------------------
-- Poderia ser um update direto na tabela, já que a política permite. Como
-- função, dá para limpar o texto num lugar só e registrar a mudança.
create or replace function public.definir_meu_departamento(p_departamento text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_limpo  text := btrim(coalesce(p_departamento, ''));
  v_perfil public.profiles;
begin
  if length(v_limpo) < 2 then
    raise exception 'DEPARTAMENTO_CURTO: escreva o nome do seu departamento.';
  end if;
  if length(v_limpo) > 60 then
    raise exception 'DEPARTAMENTO_LONGO: use no máximo 60 caracteres.';
  end if;

  -- Espaços repetidos no meio viram um só: "Financeiro   Tesouraria" agrupa
  -- junto com "Financeiro Tesouraria" numa consulta futura.
  v_limpo := regexp_replace(v_limpo, '\s+', ' ', 'g');

  update public.profiles
     set departamento = v_limpo
   where id = auth.uid()
  returning * into v_perfil;

  if v_perfil.id is null then
    raise exception 'SEM_PERFIL: sua conta não tem perfil no portal.';
  end if;

  return v_perfil;
end $$;

commit;

grant execute on function public.definir_meu_departamento(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Os departamentos já usados, para sugerir enquanto a pessoa digita
-- ---------------------------------------------------------------------------
-- Junta a lista cadastrada com o que as pessoas realmente escreveram. Assim a
-- sugestão acompanha a realidade em vez de engessar numa lista de 2026.
create or replace function public.departamentos_sugeridos()
returns table (nome text, quantas bigint)
language sql stable security definer set search_path = public as $$
  select nome, sum(quantas)::bigint as quantas
    from (
      select nome, 0::bigint as quantas from public.departamentos where ativo
      union all
      select btrim(departamento), count(*)::bigint
        from public.profiles
       where departamento is not null and btrim(departamento) <> ''
       group by btrim(departamento)
    ) t
   group by nome
   order by sum(quantas) desc, nome;
$$;

grant execute on function public.departamentos_sugeridos() to authenticated;

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   select email, departamento from public.profiles order by email;
--   select * from public.departamentos_sugeridos();
--
--   -- deve recusar, se o perfil ainda não tem departamento:
--   insert into public.boletos (...) values (...);
