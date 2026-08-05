-- ===========================================================================
-- 10_cliente_simplificado.sql — O cliente entrega, o operador completa
-- ===========================================================================
-- Rode DEPOIS de 01 a 09. Não apaga nem move dado: só afrouxa obrigatoriedades
-- na entrada e aperta na associação.
--
-- A MUDANÇA DE RESPONSABILIDADE
-- -----------------------------
-- Antes: o cliente preenchia sete etapas e conferia campo por campo. O banco
-- exigia tudo no insert, porque presumia que alguém tinha validado.
--
-- Agora: o cliente anexa o boleto e informa nome, sobrenome e e-mail. O que o
-- leitor conseguir extrair vai junto, como rascunho. Conferir é trabalho da
-- operação.
--
-- Consequência que não dá para contornar: se o cliente não preenche mais valor,
-- vencimento, número e fornecedor, e o leitor pode falhar em qualquer um deles,
-- então NADA disso pode ser obrigatório na entrada. Senão um boleto que o
-- script não conseguiu ler simplesmente não entraria — e é justamente esse que
-- mais precisa de olho humano.
--
-- A trava não desaparece: ela muda de lugar. Sai do insert e vai para a
-- associação, que é onde o dinheiro começa a andar. Um boleto incompleto pode
-- ENTRAR, mas não pode ser ASSOCIADO.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. O que deixa de ser obrigatório na entrada
-- ---------------------------------------------------------------------------
alter table public.boletos alter column numero_documento        drop not null;
alter table public.boletos alter column cc                      drop not null;
alter table public.boletos alter column unidade_negocio         drop not null;
alter table public.boletos alter column unidade_cnpj            drop not null;
alter table public.boletos alter column fornecedor_razao_social drop not null;
alter table public.boletos alter column valor                   drop not null;
alter table public.boletos alter column vencimento              drop not null;
alter table public.boletos alter column departamento            drop not null;

-- O valor podia ser nulo agora, mas se vier preenchido continua tendo que ser
-- positivo. Boleto de R$ 0,00 ou negativo é erro de leitura, não é boleto.
alter table public.boletos drop constraint if exists boletos_valor_check;
alter table public.boletos add constraint boletos_valor_positivo
  check (valor is null or valor > 0);

-- O que continua obrigatório: quem enviou, o tipo (que define a fila) e o
-- arquivo. Sem esses três não existe boleto.

-- ---------------------------------------------------------------------------
-- 2. Coluna nova: quando o solicitante viu a última mudança
-- ---------------------------------------------------------------------------
-- Serve para marcar "novidade" na lista dele. Nulo = nunca viu.
alter table public.boletos
  add column if not exists visto_pelo_solicitante_em timestamptz;

-- ---------------------------------------------------------------------------
-- 3. A validação da conta só vale quando a conta veio
-- ---------------------------------------------------------------------------
-- O gatilho antigo recusava qualquer boleto sem conta válida. Agora ele deixa
-- passar sem conta, e quando a conta VEM, continua conferindo e preenchendo os
-- dados da empresa a partir da fonte da verdade.
create or replace function public.fn_validar_conta_do_boleto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conta   public.contas_bancarias;
  v_empresa public.empresas;
  v_doc     text := regexp_replace(coalesce(new.unidade_cnpj, ''), '\D', '', 'g');
begin
  -- Num update em que conta e empresa não mudaram, não há o que revalidar.
  -- Isso evita o gatilho rodar de graça em toda associação e recusa.
  if tg_op = 'UPDATE'
     and new.cc is not distinct from old.cc
     and new.unidade_cnpj is not distinct from old.unidade_cnpj then
    return new;
  end if;

  -- Sem conta informada: passa. A operação completa depois.
  if new.cc is null or btrim(new.cc) = '' then
    new.cc := null;
    return new;
  end if;

  -- Com conta, precisa da empresa para saber de quem ela é.
  if v_doc = '' then
    raise exception 'EMPRESA_OBRIGATORIA: informe a empresa junto com a conta.';
  end if;

  select c.* into v_conta
    from public.contas_bancarias c
   where c.empresa_documento = v_doc
     and c.conta = new.cc
     and c.ativo;

  if v_conta.id is null then
    raise exception 'CONTA_INVALIDA: a conta % não pertence à empresa informada, ou está encerrada.', new.cc;
  end if;

  select e.* into v_empresa from public.empresas e where e.documento = v_conta.empresa_documento;

  new.unidade_cnpj    := v_empresa.documento;
  new.unidade_negocio := v_empresa.razao_social;
  new.conta_banco     := v_conta.banco;
  new.conta_agencia   := v_conta.agencia;
  new.conta_tipo      := v_conta.tipo_conta;

  return new;
end $$;

-- Agora vale também no update, porque é o operador que preenche a conta.
-- Uso "insert or update" simples em vez de "update of cc, unidade_cnpj": a
-- variante com lista de colunas dispara quando a coluna é MENCIONADA, não
-- quando muda de valor, o que é uma pegadinha. A guarda dentro da função é
-- mais explícita e faz o que se espera.
drop trigger if exists trg_validar_conta on public.boletos;
create trigger trg_validar_conta
  before insert or update on public.boletos
  for each row execute function public.fn_validar_conta_do_boleto();

-- ---------------------------------------------------------------------------
-- 4. O que falta neste boleto?
-- ---------------------------------------------------------------------------
-- Uma função só, usada em três lugares: na visão (para pintar o alerta), na
-- associação (para barrar) e na tela do operador (para dizer o que preencher).
-- Ter isso em um lugar só evita as três listas divergirem com o tempo.
create or replace function public.pendencias_do_boleto(b public.boletos)
returns text[] language sql immutable as $$
  select array_remove(array[
    case when b.numero_documento is null or btrim(b.numero_documento) = ''
         then 'número do documento' end,
    case when b.cc is null                then 'conta bancária' end,
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
-- 5. O operador completa o boleto
-- ---------------------------------------------------------------------------
-- Só mexe no que vier diferente de nulo, então dá para completar aos poucos.
-- Cada chamada fica registrada no histórico.
create or replace function public.completar_boleto(
  p_boleto_id        uuid,
  p_conta            text default null,
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
  v_boleto public.boletos;
  v_perfil public.profiles;
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

  update public.boletos set
    unidade_cnpj            = coalesce(nullif(regexp_replace(coalesce(p_empresa_doc,''), '\D', '', 'g'), ''), unidade_cnpj),
    cc                      = coalesce(nullif(btrim(coalesce(p_conta,'')), ''), cc),
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

-- ---------------------------------------------------------------------------
-- 6. Associar exige o boleto completo
-- ---------------------------------------------------------------------------
-- Aqui está a trava que substitui todas as que saíram da entrada. Um boleto
-- pela metade entra na fila, aparece com alerta, mas não vira pagamento.
create or replace function public.associar_boleto(
  p_boleto_id uuid,
  p_observacao text default null
) returns public.boletos
language plpgsql security definer set search_path = public as $$
declare
  v_boleto     public.boletos;
  v_perfil     public.profiles;
  v_pendencias text[];
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

  v_pendencias := public.pendencias_do_boleto(v_boleto);
  if array_length(v_pendencias, 1) is not null then
    raise exception 'INCOMPLETO: antes de associar, preencha: %.',
      array_to_string(v_pendencias, ', ');
  end if;

  update public.boletos set
    status               = 'associado',
    data_associacao      = now(),
    associado_por        = auth.uid(),
    associado_por_nome   = v_perfil.nome_completo,
    associado_por_email  = v_perfil.email,
    observacoes_operador = coalesce(p_observacao, observacoes_operador),
    visto_pelo_solicitante_em = null   -- volta a ser novidade para quem enviou
  where id = p_boleto_id
  returning * into v_boleto;

  return v_boleto;
end $$;

-- Recusar e reabrir também voltam a marcar como novidade.
create or replace function public.recusar_boleto(p_boleto_id uuid, p_motivo text)
returns public.boletos
language plpgsql security definer set search_path = public as $$
declare v_boleto public.boletos;
begin
  if not public.eh_admin() then
    raise exception 'SEM_PERMISSAO: só a equipe de operação pode recusar boletos.';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 5 then
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
    status = 'recusado', data_associacao = null, associado_por = null,
    associado_por_nome = null, associado_por_email = null,
    observacoes_operador = btrim(p_motivo),
    visto_pelo_solicitante_em = null
  where id = p_boleto_id
  returning * into v_boleto;

  return v_boleto;
end $$;

-- ---------------------------------------------------------------------------
-- 7. O solicitante marca que viu
-- ---------------------------------------------------------------------------
create or replace function public.marcar_boletos_como_vistos()
returns integer language plpgsql security definer set search_path = public as $$
declare v_quantos integer;
begin
  update public.boletos
     set visto_pelo_solicitante_em = now()
   where solicitante_id = auth.uid()
     and visto_pelo_solicitante_em is null
     and status <> 'pendente';
  get diagnostics v_quantos = row_count;
  return v_quantos;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 8. A visão ganha as pendências e a marca de novidade
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
  b.cc, b.conta_banco, b.conta_agencia, b.conta_tipo,
  b.unidade_negocio, b.unidade_cnpj, e.grupo_economico,
  b.fornecedor_razao_social, b.fornecedor_cnpj,
  b.valor, b.vencimento, b.data_pagamento_desejada,
  b.codigo_barras, b.linha_digitavel, b.banco_emissor,
  b.extracao_confianca, b.extracao_metodo, b.extracao_avisos,
  b.departamento, b.observacoes_cliente, b.observacoes_operador,
  b.status,
  b.data_associacao, b.associado_por, b.associado_por_nome, b.associado_por_email,
  b.visto_pelo_solicitante_em,
  (b.visto_pelo_solicitante_em is null and b.status <> 'pendente') as novidade_para_solicitante,

  -- O que falta preencher, e quantos itens são
  public.pendencias_do_boleto(b)                                   as pendencias,
  coalesce(array_length(public.pendencias_do_boleto(b), 1), 0)      as qtd_pendencias,

  -- O sinal de atenção da tela do operador, em um campo só:
  --   vermelho = falta dado             (não dá para associar)
  --   laranja  = completo, leitura fraca (confira o PDF)
  --   verde    = completo e conferido pelo dígito verificador
  case
    when coalesce(array_length(public.pendencias_do_boleto(b), 1), 0) > 0 then 'incompleto'
    when b.extracao_confianca <> 'alta'                                  then 'conferir'
    else 'ok'
  end                                                              as sinal_revisao,

  (b.vencimento - current_date) as dias_para_vencer,
  case
    when b.vencimento is null                    then 'sem_data'
    when b.vencimento < current_date             then 'vencido'
    when b.vencimento <= current_date + 3        then 'vence_em_breve'
    else 'em_dia'
  end as situacao_vencimento
from public.boletos b
left join public.empresas e on e.documento = b.unidade_cnpj;

grant select on public.vw_boletos_operador to authenticated;
grant execute on function public.pendencias_do_boleto(public.boletos)            to authenticated;
grant execute on function public.completar_boleto(uuid, text, text, text, numeric, date, text, text, text, boolean, text) to authenticated;
grant execute on function public.marcar_boletos_como_vistos()                     to authenticated;

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   select numero_protocolo, sinal_revisao, qtd_pendencias, pendencias
--     from public.vw_boletos_operador order by numero_protocolo;
--
--   -- deve recusar, listando o que falta:
--   select public.associar_boleto('<id-de-um-boleto-incompleto>');