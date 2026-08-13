-- ===========================================================================
-- 17_prioridade.sql — Marcar boleto como prioridade, com motivo
-- ===========================================================================
-- Rode depois do 16.
--
-- O QUE É
-- -------
-- Quem envia pode sinalizar que um ou mais boletos do lote precisam de
-- tratamento prioritário, e escrever por quê. A operação vê o sinal na fila.
--
-- POR QUE O MOTIVO É OBRIGATÓRIO
-- ------------------------------
-- Prioridade sem justificativa vira padrão: se marcar custa um clique e não
-- exige explicação, todo mundo marca, e em duas semanas metade da fila é
-- "prioritária" — que é o mesmo que nenhuma ser.
--
-- Exigir o motivo não impede o abuso, mas o torna visível: dá para consultar
-- depois quem prioriza o quê, e conversar com base em dados.
--
-- POR QUE POR BOLETO E NÃO POR LOTE
-- ---------------------------------
-- Num envio de vinte boletos, normalmente dois ou três são urgentes. Marcar o
-- lote inteiro obrigaria a pessoa a fazer dois envios, ou a marcar tudo como
-- prioridade — de novo, o mesmo que nada.
-- ===========================================================================

begin;

alter table public.boletos
  add column if not exists prioridade        boolean not null default false,
  add column if not exists motivo_prioridade text;

comment on column public.boletos.prioridade is
  'Sinalizado por quem enviou. Não muda a ordem da fila sozinho: informa a operação.';

-- Prioridade sem motivo não entra. A trava é do banco, não da tela.
alter table public.boletos drop constraint if exists boletos_prioridade_com_motivo;
alter table public.boletos add constraint boletos_prioridade_com_motivo
  check (
    prioridade = false
    or (motivo_prioridade is not null and length(btrim(motivo_prioridade)) >= 5)
  );

commit;

-- ---------------------------------------------------------------------------
-- A visão do operador mostra o sinal
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
  b.cc, b.conta_banco, b.conta_agencia, b.conta_tipo,
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

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   select numero_protocolo, prioridade, motivo_prioridade
--     from public.boletos where prioridade order by data_envio desc;
--
--   -- quem mais prioriza, para a conversa não ser no achismo:
--   select solicitante_email,
--          count(*) filter (where prioridade) as prioritarios,
--          count(*)                           as total
--     from public.boletos group by 1 order by 2 desc;
