-- ===========================================================================
-- 18_sem_cc_e_prioridade_na_fila.sql
-- ===========================================================================
-- Rode depois do 17. Duas mudanças pedidas pela equipe.
--
-- 1. O CC (CONTA BANCÁRIA) SAI DE CENA
-- ------------------------------------
-- A conta bancária não é mais usada para associar boleto. Ela deixa de ser
-- pendência, deixa de aparecer na visão do operador, e o gatilho que a validava
-- sai do caminho.
--
-- NÃO apago as colunas cc, conta_banco, conta_agencia e conta_tipo. Apagar é
-- irreversível, e os boletos antigos têm esses dados preenchidos — jogar fora
-- histórico para ganhar espaço que não falta seria um mau negócio. Elas ficam
-- na tabela, sem ninguém escrever nem ler. Se um dia vocês tiverem certeza de
-- que não fazem falta, aí sim:
--
--   alter table public.boletos
--     drop column cc, drop column conta_banco,
--     drop column conta_agencia, drop column conta_tipo;
--
-- A tabela contas_bancarias, com as 1.127 contas, também fica sem uso. Mas a
-- tabela empresas continua essencial: é ela que identifica a nossa empresa pelo
-- CNPJ e carrega as 108 denominações antigas.
--
-- 2. PRIORIDADE PRIMEIRO NA FILA
-- ------------------------------
-- Boleto marcado como prioridade passa a aparecer antes dos demais.
--
-- Um registro honesto sobre isso: eu recomendei o contrário — prioridade como
-- marca visual, sem mexer na ordem — porque furar fila é um incentivo forte
-- para marcar tudo como urgente. A equipe decidiu pela ordenação, e é decisão
-- dela. O motivo obrigatório (db/17) é o que resta como contrapeso, e vale
-- acompanhar:
--
--   select solicitante_email,
--          count(*) filter (where prioridade) as prioritarios,
--          count(*)                           as total
--     from public.boletos group by 1 order by 2 desc;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. A conta sai das pendências
-- ---------------------------------------------------------------------------
create or replace function public.pendencias_do_boleto(b public.boletos)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when b.numero_documento is null or btrim(b.numero_documento) = ''
         then 'número do documento' end,
    case when b.unidade_cnpj is null       then 'unidade de negócio' end,
    case when b.fornecedor_razao_social is null
              or btrim(b.fornecedor_razao_social) = ''
         then 'fornecedor' end,
    case when b.valor is null              then 'valor' end,
    case when b.vencimento is null         then 'vencimento' end,
    case when b.departamento is null       then 'departamento' end
  ], null);
$$;

-- ---------------------------------------------------------------------------
-- 2. O gatilho da conta sai do caminho
-- ---------------------------------------------------------------------------
-- Ele já não fazia nada quando cc vinha nulo, mas deixá-lo instalado é convite
-- a confusão futura: alguém lê o gatilho e supõe que a conta ainda importa.
drop trigger if exists trg_validar_conta on public.boletos;

-- ---------------------------------------------------------------------------
-- 3. A visão perde as colunas da conta e ganha a ordenação por prioridade
-- ---------------------------------------------------------------------------
drop view if exists public.vw_boletos_operador;
create view public.vw_boletos_operador with (security_invoker = true) as
select
  b.id, b.numero_protocolo,
  b.arquivo_caminho, b.arquivo_nome, b.arquivo_tamanho, b.arquivo_tipo,
  b.tipo_documento, b.numero_documento,
  b.tipo_documento || '-' || coalesce(b.numero_documento, 's/nº') as documento_rotulo,
  b.documento_regularizado,
  b.data_envio,
  b.solicitante_id, b.solicitante_nome_completo as nome, b.solicitante_email,
  b.solicitante_informado,
  b.unidade_negocio, b.unidade_cnpj, e.grupo_economico,
  b.fornecedor_razao_social, b.fornecedor_cnpj,
  b.valor, b.vencimento, b.data_pagamento_desejada,
  b.codigo_barras, b.linha_digitavel, b.banco_emissor,
  b.extracao_confianca, b.extracao_metodo, b.extracao_avisos,
  b.departamento, b.observacoes_cliente, b.observacoes_operador,
  b.prioridade, b.motivo_prioridade,
  b.status,
  b.data_associacao, b.associado_por, b.associado_por_nome, b.associado_por_email,
  b.visto_pelo_solicitante_em,
  (b.visto_pelo_solicitante_em is null and b.status <> 'pendente') as novidade_para_solicitante,
  public.pendencias_do_boleto(b)                                   as pendencias,
  coalesce(array_length(public.pendencias_do_boleto(b), 1), 0)      as qtd_pendencias,
  case
    when coalesce(array_length(public.pendencias_do_boleto(b), 1), 0) > 0 then 'incompleto'
    when b.extracao_confianca <> 'alta'                                  then 'conferir'
    else 'ok'
  end                                                              as sinal_revisao,
  (b.vencimento - current_date) as dias_para_vencer,
  case
    when b.vencimento is null             then 'sem_data'
    when b.vencimento < current_date      then 'vencido'
    when b.vencimento <= current_date + 3 then 'vence_em_breve'
    else 'em_dia'
  end as situacao_vencimento
from public.boletos b
left join public.empresas e on e.documento = b.unidade_cnpj;

grant select on public.vw_boletos_operador to authenticated;

-- ---------------------------------------------------------------------------
-- 4. completar_boleto deixa de receber conta
-- ---------------------------------------------------------------------------
-- A assinatura muda, então o DROP é obrigatório.
drop function if exists public.completar_boleto(uuid, text, text, text, numeric, date, text, text, text, boolean, text);

create or replace function public.completar_boleto(
  p_boleto_id        uuid,
  p_empresa_doc      text default null,
  p_numero_documento text default null,
  p_valor            numeric default null,
  p_vencimento       date default null,
  p_fornecedor       text default null,
  p_fornecedor_cnpj  text default null,
  p_departamento     text default null,
  p_regularizado     boolean default null,
  p_observacao       text default null
) returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto  public.boletos;
  v_perfil  public.profiles;
  v_empresa public.empresas;
  v_doc     text := nullif(regexp_replace(coalesce(p_empresa_doc, ''), '\D', '', 'g'), '');
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: só a equipe de operação pode completar boletos.';
  end if;

  select * into v_perfil from public.profiles where id = auth.uid();
  select * into v_boleto from public.boletos where id = p_boleto_id for update;

  if v_boleto.id is null then
    raise exception 'NAO_ENCONTRADO: boleto não existe.';
  end if;
  if not public.posso_ver_tipo(v_boleto.tipo_documento) then
    raise exception 'FORA_DO_ESCOPO: este boleto não é do tipo que você trabalha.';
  end if;
  if v_boleto.status = 'associado' then
    raise exception 'JA_ASSOCIADO: reabra o boleto antes de alterar os dados.';
  end if;

  -- A empresa continua sendo validada contra a planilha: o CNPJ dela é o que
  -- amarra o boleto ao grupo, e isso não mudou.
  if v_doc is not null then
    select * into v_empresa from public.empresas where documento = v_doc and ativo;
    if v_empresa.documento is null then
      raise exception 'EMPRESA_INVALIDA: o CNPJ % não está na planilha de empresas.', v_doc;
    end if;
  end if;

  update public.boletos set
    unidade_cnpj            = coalesce(v_empresa.documento, unidade_cnpj),
    unidade_negocio         = coalesce(v_empresa.razao_social, unidade_negocio),
    numero_documento        = coalesce(nullif(btrim(coalesce(p_numero_documento,'')), ''), numero_documento),
    valor                   = coalesce(p_valor, valor),
    vencimento              = coalesce(p_vencimento, vencimento),
    fornecedor_razao_social = coalesce(nullif(btrim(coalesce(p_fornecedor,'')), ''), fornecedor_razao_social),
    fornecedor_cnpj         = coalesce(nullif(regexp_replace(coalesce(p_fornecedor_cnpj,''), '\D', '', 'g'), ''), fornecedor_cnpj),
    departamento            = coalesce(nullif(btrim(coalesce(p_departamento,'')), ''), departamento),
    documento_regularizado  = coalesce(p_regularizado, documento_regularizado),
    observacoes_operador    = coalesce(p_observacao, observacoes_operador)
  where id = p_boleto_id
  returning * into v_boleto;

  insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
  values (p_boleto_id, 'completado',
          case when array_length(public.pendencias_do_boleto(v_boleto), 1) is null
               then 'dados completados pela operação'
               else 'dados parcialmente completados; falta: ' ||
                    array_to_string(public.pendencias_do_boleto(v_boleto), ', ') end,
          auth.uid(), v_perfil.email);

  return v_boleto;
end $$;

grant execute on function public.completar_boleto(uuid, text, text, numeric, date, text, text, text, boolean, text) to authenticated;
grant execute on function public.pendencias_do_boleto(public.boletos) to authenticated;

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   -- a conta não é mais pendência:
--   select numero_protocolo, qtd_pendencias, pendencias
--     from public.vw_boletos_operador order by numero_protocolo;
--
--   -- prioridade primeiro, depois vencimento:
--   select prioridade, vencimento, numero_protocolo
--     from public.vw_boletos_operador
--    order by prioridade desc, vencimento asc nulls first;
