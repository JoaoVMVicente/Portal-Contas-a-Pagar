-- ===========================================================================
-- 09_duplicidade.sql — Avisar quando um boleto já passou pelo portal
-- ===========================================================================
-- ATENÇÃO: este arquivo nunca foi rodado no banco. Descobri isso ao clonar o
-- repositório — ele não estava em db/, e o console do navegador mostrava:
--
--     Failed to load resource: .../situacao_do_codigo   404
--     Não consegui conferir duplicidade
--
-- O bloqueio de boleto repetido continuou funcionando, mas pelo caminho ruim:
-- o índice único do banco recusa no momento do INSERT, depois da pessoa
-- preencher tudo. O aviso amigável na etapa 1, que evita esse trabalho todo,
-- nunca funcionou.
--
-- Pode rodar agora, fora de ordem. Ele não depende de 10 a 14; só cria uma
-- função de consulta.
--
-- POR QUE PRECISA SER "SECURITY DEFINER"
-- --------------------------------------
-- Um solicitante NÃO pode ler os boletos de outras pessoas — é a trava mais
-- importante do portal. Mas ele precisa saber que "este boleto já existe".
--
-- Uma consulta normal não resolve: o RLS esconderia a linha e a resposta seria
-- "não existe", que é falso. Então a função roda com poderes elevados e
-- devolve, de propósito, MENOS do que tem acesso:
--
--   sempre          protocolo, situação, datas
--   só se for seu,
--   ou se você é
--   da operação     quem enviou, valor, fornecedor, motivo da recusa
--
-- Assim quem envia descobre que o boleto já passou por aqui e a quem recorrer,
-- sem ganhar uma janela para os dados dos colegas.
--
-- E não há risco de alguém sair testando códigos: são 44 dígitos com dígito
-- verificador. Para consultar um, é preciso ter o boleto na mão.
-- ===========================================================================

create or replace function public.situacao_do_codigo(p_codigo text)
returns table (
  numero_protocolo      bigint,
  status                status_boleto,
  tipo_documento        tipo_documento,
  numero_documento      text,
  data_envio            timestamptz,
  data_associacao       timestamptz,
  sou_eu                boolean,
  quem_enviou           text,
  valor                 numeric,
  fornecedor            text,
  motivo_da_recusa      text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_digitos text := regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g');
  v_admin   boolean := public.eh_admin();
begin
  if length(v_digitos) <> 44 then
    return;
  end if;

  return query
  select
    b.numero_protocolo,
    b.status,
    b.tipo_documento,
    b.numero_documento,
    b.data_envio,
    b.data_associacao,
    (b.solicitante_id = auth.uid())                                as sou_eu,
    case when b.solicitante_id = auth.uid() or v_admin
         then b.solicitante_nome_completo else null end            as quem_enviou,
    case when b.solicitante_id = auth.uid() or v_admin
         then b.valor else null end                                as valor,
    case when b.solicitante_id = auth.uid() or v_admin
         then b.fornecedor_razao_social else null end              as fornecedor,
    case when b.solicitante_id = auth.uid() or v_admin
         then b.observacoes_operador else null end                 as motivo_da_recusa
  from public.boletos b
  where b.codigo_barras = v_digitos
  order by b.data_envio desc;
end $$;

comment on function public.situacao_do_codigo(text) is
  'Diz se um código de barras já passou pelo portal, sem expor dados de boletos de outras pessoas.';

grant execute on function public.situacao_do_codigo(text) to authenticated;

-- ===========================================================================
-- CONFERÊNCIA
-- ===========================================================================
--   -- pegue um código de barras que já esteja no portal:
--   select codigo_barras from public.boletos where codigo_barras is not null limit 1;
--
--   -- e consulte:
--   select * from public.situacao_do_codigo('<cole aqui>');
--
--   -- lixo devolve vazio, sem erro:
--   select * from public.situacao_do_codigo('abc');
