-- ===========================================================================
-- 04_rls.sql — AS TRANCAS
-- ===========================================================================
-- Este é o arquivo mais importante do banco. Vale ler com calma.
--
-- A METÁFORA
-- ----------
-- Imagine o armário de fichas da secretaria da escola. Sem tranca, todos
-- confiam que ninguém vai bisbilhotar a ficha alheia. Com RLS, o armário tem
-- uma tranca mágica: quando VOCÊ abre a gaveta, só existem lá dentro as fichas
-- que você tem direito de ver. As outras não estão ali — não é que estejam
-- escondidas, é que não existem para você.
--
-- POR QUE NO BANCO E NÃO NA TELA
-- ------------------------------
-- O JavaScript da tela roda no computador da outra pessoa. Ela pode abrir o
-- console e mandar o que quiser. Regra que só existe na tela é um cartaz na
-- parede: qualquer um arranca. RLS é a tranca do armário.
--
-- O QUE MUDA NESTA VERSÃO
-- -----------------------
-- Antes, um operador via todos os boletos. Agora ele vê só os do TIPO que
-- trabalha: quem cuida de nota fiscal não vê medição, e vice-versa. Quem tem
-- escopo 'ambos' continua vendo tudo. E isso está aqui, no banco — não é só
-- um filtro bonito na tela.
-- ===========================================================================

alter table public.profiles          enable row level security;
alter table public.admin_emails      enable row level security;
alter table public.empresas          enable row level security;
alter table public.contas_bancarias  enable row level security;
alter table public.departamentos     enable row level security;
alter table public.boletos           enable row level security;
alter table public.boleto_eventos    enable row level security;

-- ---------------------------------------------------------------- profiles --
drop policy if exists "perfil: leio o meu" on public.profiles;
create policy "perfil: leio o meu" on public.profiles
  for select using (id = auth.uid() or public.eh_admin());

drop policy if exists "perfil: edito o meu nome" on public.profiles;
create policy "perfil: edito o meu nome" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    -- Não dá para se promover a operador, nem trocar o próprio escopo.
    and papel  = (select papel  from public.profiles where id = auth.uid())
    and escopo = (select escopo from public.profiles where id = auth.uid())
  );

-- ------------------------------------------------------------ admin_emails --
-- Só operador lê. Ninguém edita pela tela: mexer nesta lista é ato
-- administrativo, feito pelo SQL Editor por quem tem a chave do projeto.
drop policy if exists "admins: só operador lê" on public.admin_emails;
create policy "admins: só operador lê" on public.admin_emails
  for select using (public.eh_admin());

-- --------------------------------------------------- empresas e contas -----
-- Leitura liberada para quem está logado: o formulário precisa disso para
-- funcionar. Escrita, ninguém — a carga vem do importador de Excel.
drop policy if exists "empresas: logado lê" on public.empresas;
create policy "empresas: logado lê" on public.empresas
  for select using (auth.uid() is not null and ativo);

drop policy if exists "contas: logado lê" on public.contas_bancarias;
create policy "contas: logado lê" on public.contas_bancarias
  for select using (auth.uid() is not null and ativo);

drop policy if exists "departamentos: logado lê" on public.departamentos;
create policy "departamentos: logado lê" on public.departamentos
  for select using (auth.uid() is not null and ativo);

-- ----------------------------------------------------------------- boletos --

-- LEITURA
-- Cliente: só os próprios boletos.
-- Operador: os boletos do tipo que ele trabalha.
drop policy if exists "boletos: leitura" on public.boletos;
create policy "boletos: leitura" on public.boletos
  for select using (
    solicitante_id = auth.uid()
    or (public.eh_admin() and public.posso_ver_tipo(tipo_documento))
  );

-- CRIAÇÃO
-- Qualquer pessoa logada pode criar, com quatro exigências:
--   1. o boleto tem que ser dela;
--   2. nasce pendente (não dá para criar já associado);
--   3. nasce sem quem/quando associou;
--   4. o par empresa + conta é conferido pelo gatilho trg_validar_conta.
drop policy if exists "boletos: crio o meu" on public.boletos;
create policy "boletos: crio o meu" on public.boletos
  for insert with check (
    solicitante_id = auth.uid()
    and status = 'pendente'
    and data_associacao is null
    and associado_por is null
  );

-- ATUALIZAÇÃO
-- Só operador, e só dentro do escopo dele. Na prática as telas usam as
-- funções associar/recusar/reabrir; esta política é a rede de segurança.
drop policy if exists "boletos: operador atualiza" on public.boletos;
create policy "boletos: operador atualiza" on public.boletos
  for update using (public.eh_admin() and public.posso_ver_tipo(tipo_documento))
  with check (public.eh_admin() and public.posso_ver_tipo(tipo_documento));

-- APAGAR
-- Nenhuma política de delete existe, de propósito. Boleto errado é RECUSADO,
-- não deletado — assim o histórico continua contando a verdade.

-- ----------------------------------------------------------- boleto_eventos --
drop policy if exists "eventos: vejo os dos meus boletos" on public.boleto_eventos;
create policy "eventos: vejo os dos meus boletos" on public.boleto_eventos
  for select using (
    exists (
      select 1 from public.boletos b
       where b.id = boleto_eventos.boleto_id
         and (b.solicitante_id = auth.uid()
              or (public.eh_admin() and public.posso_ver_tipo(b.tipo_documento)))
    )
  );

-- ------------------------------------------------------------------ grants --
grant usage on schema public to authenticated;

grant select on public.profiles, public.admin_emails, public.empresas,
                public.contas_bancarias, public.departamentos,
                public.boletos, public.boleto_eventos to authenticated;
grant update on public.profiles to authenticated;
grant insert on public.boletos to authenticated;
grant update on public.boletos to authenticated;

grant select on public.vw_boletos_operador, public.vw_empresas,
                public.vw_contas, public.vw_kpis to authenticated;

grant execute on function public.eh_admin()                              to authenticated;
grant execute on function public.meu_papel()                             to authenticated;
grant execute on function public.meu_escopo()                            to authenticated;
grant execute on function public.posso_ver_tipo(tipo_documento)          to authenticated;
grant execute on function public.kpis_boletos(tipo_documento)            to authenticated;
grant execute on function public.associar_boleto(uuid, text)             to authenticated;
grant execute on function public.recusar_boleto(uuid, text)              to authenticated;
grant execute on function public.reabrir_boleto(uuid, text)              to authenticated;
grant execute on function public.contas_da_empresa(text)                 to authenticated;
grant execute on function public.empresa_da_conta(text)                  to authenticated;
grant execute on function public.buscar_empresas(text, int)              to authenticated;

-- ===========================================================================
-- CONFERÊNCIA — rode isto depois. Todas as tabelas precisam vir com true.
-- ===========================================================================
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' order by tablename;
