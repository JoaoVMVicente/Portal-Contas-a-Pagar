-- ===========================================================================
-- 13_identidade_e_lote.sql — Quem enviou é quem está logado. Sem exceção.
-- ===========================================================================
-- Rode DEPOIS de 01 a 12.
--
-- A FRAGILIDADE QUE ISTO FECHA
-- ----------------------------
-- A política de insert exigia solicitante_id = auth.uid(), então ninguém
-- conseguia gravar um boleto no ID de outra pessoa. Mas as colunas
-- solicitante_nome, solicitante_sobrenome e solicitante_email eram texto livre
-- vindo do navegador.
--
-- Na prática: logado com a minha conta, eu podia gravar o e-mail e o nome de
-- qualquer colega. O painel do operador mostraria essa pessoa como solicitante
-- do pagamento. O rastro verdadeiro existia em boleto_eventos, que sempre
-- gravou o auth.uid() real — mas ninguém olha o histórico no dia a dia, e a
-- tela mostrava a mentira.
--
-- Num sistema de contas a pagar, "quem pediu este pagamento" precisa ser
-- inforjável. Não é vazamento de dados; é controle interno.
--
-- POR QUE CARIMBAR EM VEZ DE VALIDAR
-- ----------------------------------
-- Validar seria comparar o que veio com o perfil e recusar se diferisse. Isso
-- funciona, mas depende de eu lembrar de validar cada campo, hoje e sempre.
--
-- Carimbar é mais forte: o banco IGNORA o que o navegador mandou e escreve os
-- valores do perfil autenticado. Não se falsifica o que não se pode informar.
-- Vale para o portal, para quem chamar a API direto, e para qualquer tela que
-- venha a existir.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. O que o navegador tentou dizer, quando diferiu
-- ---------------------------------------------------------------------------
-- Normalmente nulo. Preenchido só quando alguém manda um e-mail diferente do
-- da própria conta — que é exatamente o que uma tentativa de forjar parece.
alter table public.boletos
  add column if not exists solicitante_informado text;

comment on column public.boletos.solicitante_informado is
  'O que o cliente afirmou ser, quando diferente do perfil autenticado. Nulo é o normal.';

-- ---------------------------------------------------------------------------
-- 2. O carimbo
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

  -- O carimbo. Tudo que o navegador mandou nestes campos é descartado.
  new.solicitante_id         := auth.uid();
  new.solicitante_email      := v_perfil.email;
  new.solicitante_nome       := coalesce(nullif(btrim(v_perfil.nome), ''),
                                         split_part(v_perfil.email, '@', 1));
  new.solicitante_sobrenome  := coalesce(btrim(v_perfil.sobrenome), '');
  new.solicitante_informado  := v_informado;

  return new;
end $$;

-- BEFORE INSERT: roda antes da política de insert conferir, então o
-- solicitante_id já chega correto e a política nunca recusa por isso.
drop trigger if exists trg_carimbar_solicitante on public.boletos;
create trigger trg_carimbar_solicitante
  before insert on public.boletos
  for each row execute function public.fn_carimbar_solicitante();

-- ---------------------------------------------------------------------------
-- 3. E ninguém reescreve o solicitante depois
-- ---------------------------------------------------------------------------
-- Sem isto, um operador poderia trocar o nome do solicitante num update.
create or replace function public.fn_travar_solicitante()
returns trigger language plpgsql as $$
begin
  if new.solicitante_id        is distinct from old.solicitante_id
  or new.solicitante_email     is distinct from old.solicitante_email
  or new.solicitante_nome      is distinct from old.solicitante_nome
  or new.solicitante_sobrenome is distinct from old.solicitante_sobrenome then
    raise exception 'SOLICITANTE_IMUTAVEL: quem enviou o boleto não pode ser alterado.';
  end if;
  return new;
end $$;

drop trigger if exists trg_travar_solicitante on public.boletos;
create trigger trg_travar_solicitante
  before update on public.boletos
  for each row execute function public.fn_travar_solicitante();

-- ---------------------------------------------------------------------------
-- 4. O histórico registra a tentativa
-- ---------------------------------------------------------------------------
create or replace function public.fn_registrar_evento_boleto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := coalesce((select email from public.profiles where id = auth.uid()), 'sistema');
begin
  if tg_op = 'INSERT' then
    insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
    values (new.id, 'criado',
            format('%s-%s · %s · R$ %s',
                   new.tipo_documento,
                   coalesce(new.numero_documento, 's/nº'),
                   coalesce(new.fornecedor_razao_social, 'fornecedor não lido'),
                   coalesce(new.valor::text, '?')),
            auth.uid(), v_email);

    -- Divergência de identidade vira evento próprio, para aparecer no
    -- histórico do boleto e numa consulta simples.
    if new.solicitante_informado is not null then
      insert into public.boleto_eventos (boleto_id, tipo, observacao, usuario_id, usuario_email)
      values (new.id, 'identidade-divergente', new.solicitante_informado, auth.uid(), v_email);
    end if;

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

-- ---------------------------------------------------------------------------
-- 5. A política de insert não precisa mais checar o id
-- ---------------------------------------------------------------------------
-- O carimbo já garante. Mantemos a checagem mesmo assim: se o gatilho for
-- removido por engano um dia, a política ainda segura.
drop policy if exists "boletos: envio do cliente" on public.boletos;
create policy "boletos: envio do cliente" on public.boletos
  for insert with check (
    solicitante_id = auth.uid()
    and status = 'pendente'
    and data_associacao is null
    and associado_por is null
  );

commit;

-- ---------------------------------------------------------------------------
-- 6. A visão mostra a divergência para o operador
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
-- Tente forjar, logado no portal, pelo console do navegador. O boleto deve
-- entrar com o SEU e-mail, não com o informado, e com o registro da tentativa:
--
--   select numero_protocolo, solicitante_email, solicitante_informado
--     from public.boletos where solicitante_informado is not null;
--
--   select b.numero_protocolo, e.tipo, e.observacao, e.usuario_email
--     from public.boleto_eventos e
--     join public.boletos b on b.id = e.boleto_id
--    where e.tipo = 'identidade-divergente';
