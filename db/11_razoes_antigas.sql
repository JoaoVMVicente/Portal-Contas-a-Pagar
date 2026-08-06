-- ===========================================================================
-- 12_razoes_antigas.sql — Achar a empresa pelo nome antigo
-- ===========================================================================
-- Rode DEPOIS de 01 a 11, e depois rode de novo o db/07_seed_contas.sql
-- (regerado pelo importador com os nomes antigos incluídos).
--
-- O PROBLEMA
-- ----------
-- O grupo passou por uma renomeação grande: Omega virou Serena, Porto do
-- Parnaíba virou Delta 1 II, Parque Eólico Assuruá III virou Assuruá 2 I.
-- São 108 empresas com nome anterior registrado.
--
-- Um boleto emitido antes da mudança, ou por fornecedor que não atualizou o
-- cadastro, chega com o nome velho. Quem procurasse "Porto do Parnaíba" no
-- portal não acharia nada, e teria que abrir uma planilha à parte para
-- descobrir o nome de hoje.
--
-- A coluna nomes_alternativos já existia desde o 01, mas por dois motivos ela
-- não resolvia: vinha só com variações que apareciam no próprio Mapa de Contas,
-- e a função de busca não olhava para ela.
-- ===========================================================================

alter table public.empresas
  add column if not exists razao_social_juridica text;

comment on column public.empresas.razao_social_juridica is
  'Razão social conforme consulta oficial. Pode diferir da razao_social, que vem do Mapa de Contas.';

comment on column public.empresas.nomes_alternativos is
  'Nomes antigos e variações. É por aqui que um boleto com denominação anterior encontra a empresa.';

-- ---------------------------------------------------------------------------
-- A busca passa a olhar os nomes antigos
-- ---------------------------------------------------------------------------
-- Ordem de preferência no resultado: quem casa pelo nome atual vem antes de
-- quem casa só pelo nome antigo. Assim, procurar "Serena Geração" não traz
-- primeiro uma empresa cujo nome ANTIGO era parecido.
-- O DROP é obrigatório aqui, e vale explicar por quê: esta função ganhou duas
-- colunas no resultado (achou_por e nome_que_casou). O Postgres não deixa um
-- "create or replace" mudar o formato de retorno — ele recusa com
-- "cannot change return type of existing function". Só apagando e recriando.
--
-- É seguro: nenhuma visão ou gatilho depende dela, só o portal, que chama pelo
-- nome. Entre o drop e o create não há intervalo perceptível.
drop function if exists public.buscar_empresas(text, int);

create or replace function public.buscar_empresas(p_termo text, p_limite int default 30)
returns table (
  documento         text,
  razao_social      text,
  grupo_economico   text,
  qtd_contas        bigint,
  achou_por         text,
  nome_que_casou    text
) language sql stable security invoker set search_path = public as $$
  with termo as (
    select
      regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as so_digitos,
      upper(unaccent(coalesce(p_termo, '')))               as texto
  ),
  candidatas as (
    select
      e.documento,
      e.razao_social,
      e.grupo_economico,
      case
        when length(t.so_digitos) >= 3 and e.documento like '%' || t.so_digitos || '%'
          then 'documento'
        when length(t.texto) >= 2 and (
               e.chave_busca like '%' || t.texto || '%'
               or upper(unaccent(e.razao_social)) like '%' || t.texto || '%')
          then 'nome atual'
        when length(t.texto) >= 2
             and e.razao_social_juridica is not null
             and upper(unaccent(e.razao_social_juridica)) like '%' || t.texto || '%'
          then 'nome jurídico'
        when length(t.texto) >= 2 and exists (
               select 1 from unnest(e.nomes_alternativos) as alt
                where upper(unaccent(alt)) like '%' || t.texto || '%')
          then 'nome anterior'
        else null
      end as achou_por,
      (select alt from unnest(e.nomes_alternativos) as alt
        where length(t.texto) >= 2 and upper(unaccent(alt)) like '%' || t.texto || '%'
        limit 1) as alternativo_casado
    from public.empresas e, termo t
    where e.ativo
  )
  select
    c.documento,
    c.razao_social,
    c.grupo_economico,
    (select count(*) from public.contas_bancarias cb
      where cb.empresa_documento = c.documento and cb.ativo)::bigint,
    c.achou_por,
    case when c.achou_por = 'nome anterior' then c.alternativo_casado else c.razao_social end
  from candidatas c
  where c.achou_por is not null
  order by
    case c.achou_por
      when 'documento'     then 1
      when 'nome atual'    then 2
      when 'nome jurídico' then 3
      else 4
    end,
    c.razao_social
  limit greatest(1, least(p_limite, 100));
$$;

grant execute on function public.buscar_empresas(text, int) to authenticated;

-- ===========================================================================
-- CONFERÊNCIA — depois de rodar o 07 regerado
-- ===========================================================================
--   select count(*) from public.empresas where nomes_alternativos <> '{}';
--     -- deve dar 108
--
--   select razao_social, achou_por, nome_que_casou
--     from public.buscar_empresas('Porto do Parnaiba', 5);
--     -- deve achar "DELTA 1 II ENERGIA S.A." por "nome anterior"
--
--   select razao_social, achou_por from public.buscar_empresas('Omega Geracao', 5);
--     -- deve achar "SERENA GERAÇÃO S.A."
