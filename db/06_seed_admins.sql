-- ===========================================================================
-- 06_seed_admins.sql — Quem é da operação, e o que cada um enxerga
-- ===========================================================================
-- Três escopos:
--   'NF'    -> a pessoa só vê notas fiscais
--   'MD'    -> a pessoa só vê medições
--   'ambos' -> vê as duas, com um alternador no topo da tela
--
-- Estar nesta lista NÃO cria conta. Quando a pessoa ativar a conta dela pelo
-- link que chega no e-mail, o papel de operador é aplicado automaticamente.
-- ===========================================================================

insert into public.admin_emails (email, nome_sugerido, escopo, observacao) values
  -- ------------------------------------------------------------ AS DUAS ----
  ('joao.vicente@srna.co',            'João Vicente',    'ambos', 'Responsável pelo processo'),
  ('sit.pedro.moreira@ext.srna.co',   'Pedro Moreira',   'ambos', 'Faz a associação no dia a dia'),

  -- ----------------------------------------------- SOMENTE MEDIÇÕES (MD) ---
  ('thais.lima@srna.co',              'Thaís Lima',      'MD',    'Time de medições'),
  ('ran.karoline.lima@ext.srna.co',   'Karoline Lima',   'MD',    'Time de medições'),

  -- ------------------------------------------- SOMENTE NOTAS FISCAIS (NF) --
  ('kelly.silva@srna.co',             'Kelly Silva',     'NF',    null),
  ('rodrigo.rabelo@srna.co',          'Rodrigo Rabelo',  'NF',    null),
  ('luana.silva@srna.co',             'Luana Silva',     'NF',    null),
  ('ellen.kim@srna.co',               'Ellen Kim',       'NF',    null),
  ('ellen.marques@srna.co',           'Ellen Marques',   'NF',    null),
  ('vanessa.rodrigues@srna.co',       'Vanessa Rodrigues','NF',   null),
  ('natalia.inacio@srna.co',          'Natália Inácio',  'NF',    null),
  ('danilo.viana@srna.co',            'Danilo Viana',    'NF',    null),
  ('caique.brito@srna.co',            'Caique Brito',    'NF',    null),
  ('debora.silva@srna.co',            'Débora Silva',    'NF',    null),
  ('danilo.salmazi@srna.co',          'Danilo Salmazi',  'NF',    null),
  ('andre.teixeira@srna.co',          'André Teixeira',  'NF',    null),
  ('tka.moises.bianco@ext.srna.co',   'Moisés Bianco',   'NF',    'Terceirizado do time')
on conflict (email) do update set
  nome_sugerido = excluded.nome_sugerido,
  escopo        = excluded.escopo,
  observacao    = excluded.observacao;

-- --------------------------------------------------------- DEPARTAMENTOS --
insert into public.departamentos (nome, ordem) values
  ('Financeiro', 10),
  ('Contas a Pagar', 20),
  ('Gestão de Ativos', 30),
  ('Operação e Manutenção', 40),
  ('Engenharia', 50),
  ('Suprimentos', 60),
  ('Jurídico', 70),
  ('Regulatório', 80),
  ('Tecnologia', 90),
  ('Pessoas', 100),
  ('Outro', 999)
on conflict (nome) do update set ordem = excluded.ordem, ativo = true;

-- Conferência:
--   select escopo, count(*) from public.admin_emails group by escopo;
