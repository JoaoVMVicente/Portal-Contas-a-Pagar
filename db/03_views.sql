-- ===========================================================================
-- 03_views.sql — As "janelinhas" que já entregam a tela pronta
-- ===========================================================================
-- security_invoker = true faz a visão rodar com os poderes de QUEM CONSULTA.
-- Sem isso ela rodaria com os poderes de quem criou, e o RLS seria ignorado —
-- ou seja, todo mundo veria tudo. É uma linha pequena com efeito grande.
-- ===========================================================================

drop view if exists public.vw_boletos_operador;
create view public.vw_boletos_operador with (security_invoker = true) as
select
  b.id,
  b.numero_protocolo,

  -- "Boleto" (o clipe)
  b.arquivo_caminho,
  b.arquivo_nome,
  b.arquivo_tamanho,
  b.arquivo_tipo,

  -- "NF/MD"
  b.tipo_documento,
  b.numero_documento,
  b.tipo_documento || '-' || b.numero_documento as documento_rotulo,
  b.documento_regularizado,

  -- "Data"
  b.data_envio,

  -- "Nome"
  b.solicitante_id,
  b.solicitante_nome_completo as nome,
  b.solicitante_email,

  -- "CC" e o contexto da conta
  b.cc,
  b.conta_banco,
  b.conta_agencia,
  b.conta_tipo,

  -- "Und. neg / CNPJ"
  b.unidade_negocio,
  b.unidade_cnpj,
  e.grupo_economico,

  -- "Fornecedor / CNPJ"
  b.fornecedor_razao_social,
  b.fornecedor_cnpj,

  -- "Valor" e "Vencimento"
  b.valor,
  b.vencimento,
  b.data_pagamento_desejada,

  -- "Cód Barras"
  b.codigo_barras,
  b.linha_digitavel,
  b.banco_emissor,
  b.extracao_confianca,
  b.extracao_metodo,
  b.extracao_avisos,

  b.departamento,
  b.observacoes_cliente,
  b.observacoes_operador,

  b.status,

  -- "Data associação" e "Executado por"
  b.data_associacao,
  b.associado_por,
  b.associado_por_nome,
  b.associado_por_email,

  -- Calculados aqui para a tela não fazer conta de data no JavaScript
  (b.vencimento - current_date) as dias_para_vencer,
  case
    when b.vencimento < current_date then 'vencido'
    when b.vencimento <= current_date + 3 then 'vence_em_breve'
    else 'em_dia'
  end as situacao_vencimento

from public.boletos b
left join public.empresas e on e.documento = b.unidade_cnpj;

comment on view public.vw_boletos_operador is
  'Uma linha por boleto, com as colunas nomeadas como aparecem na tela do operador.';

-- --------------------------------------------------------------------------
-- Empresas com a contagem de contas ativas
-- --------------------------------------------------------------------------
drop view if exists public.vw_empresas;
create view public.vw_empresas with (security_invoker = true) as
select
  e.documento,
  e.documento_tipo,
  e.razao_social,
  e.nomes_alternativos,
  e.chave_busca,
  e.grupo_economico,
  e.codigo_interno,
  count(c.id) filter (where c.ativo) as contas_ativas,
  count(c.id) as contas_total
from public.empresas e
left join public.contas_bancarias c on c.empresa_documento = e.documento
where e.ativo
group by e.documento, e.documento_tipo, e.razao_social, e.nomes_alternativos,
         e.chave_busca, e.grupo_economico, e.codigo_interno;

-- --------------------------------------------------------------------------
-- Contas com o nome da empresa junto — é o que preenche o seletor de conta
-- --------------------------------------------------------------------------
drop view if exists public.vw_contas;
create view public.vw_contas with (security_invoker = true) as
select
  c.id,
  c.conta,
  c.conta_digitos,
  c.banco,
  c.cod_banco,
  c.agencia,
  c.tipo_conta,
  e.documento    as empresa_documento,
  e.razao_social as empresa_razao_social,
  e.grupo_economico,
  -- Um rótulo pronto para o seletor: uma empresa pode ter 31 contas, e sem
  -- banco e tipo na frente ninguém distingue uma da outra.
  concat_ws(' · ',
    c.conta,
    nullif(c.banco, ''),
    nullif(c.agencia, ''),
    nullif(c.tipo_conta, '')
  ) as rotulo
from public.contas_bancarias c
join public.empresas e on e.documento = c.empresa_documento
where c.ativo and e.ativo;

-- --------------------------------------------------------------------------
-- Os quatro cartões, separados por tipo — útil para conferir no SQL Editor
-- --------------------------------------------------------------------------
drop view if exists public.vw_kpis;
create view public.vw_kpis with (security_invoker = true) as
select
  tipo_documento,
  count(*)                                          as total_boletos,
  coalesce(sum(valor), 0)                           as valor_total,
  count(*) filter (where status = 'pendente')       as pendentes,
  count(*) filter (where status = 'associado')      as associados,
  count(*) filter (where status = 'recusado')       as recusados
from public.boletos
group by tipo_documento;
