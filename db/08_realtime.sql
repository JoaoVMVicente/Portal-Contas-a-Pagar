-- ===========================================================================
-- 08_realtime.sql — O "avisa quando mudar" dos quatro cartões
-- ===========================================================================
-- Sem isto, os cartões só atualizam quando alguém aperta F5. Com isto, o
-- Postgres avisa o navegador que algo mudou, e a tela se atualiza sozinha.
--
-- O aviso respeita o RLS: cada pessoa só é notificada de linhas que ela
-- poderia ler. Um operador de NF não recebe aviso de uma medição.
-- ===========================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'boletos'
  ) then
    alter publication supabase_realtime add table public.boletos;
  end if;
end $$;

-- replica identity full: o aviso vem com a linha inteira, não só a chave.
-- Precisamos disso para o front-end saber o TIPO do boleto que mudou e
-- decidir se aquele aviso interessa para a tela que está aberta.
alter table public.boletos replica identity full;
