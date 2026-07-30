-- ===========================================================================
-- 05_storage.sql — Onde os arquivos PDF dos boletos ficam guardados
-- ---------------------------------------------------------------------------
-- O Supabase Storage é como uma pasta na nuvem, mas com porteiro (as mesmas
-- regras de RLS). Organizamos os arquivos assim:
--
--     boletos/<id-do-usuario>/<ano>/<mes>/<carimbo>-<nome-do-arquivo>.pdf
--
-- A primeira pasta é o ID de quem enviou. Isso é o que permite a regra
-- "cliente só mexe na própria pasta" funcionar de forma simples e segura.
-- ===========================================================================

-- Cria o bucket (a "pasta raiz"). private = ninguém acessa por link solto;
-- para baixar, o sistema gera um link temporário assinado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'boletos',
  'boletos',
  false,
  10485760,  -- 10 MB por arquivo
  array['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
on conflict (id) do update
  set file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public            = false;


-- ---------------------------------------------------------------------------
-- Regras de acesso aos arquivos
-- ---------------------------------------------------------------------------
drop policy if exists "arquivo: cliente envia na sua pasta"  on storage.objects;
drop policy if exists "arquivo: cliente le a sua pasta"      on storage.objects;
drop policy if exists "arquivo: cliente troca o seu arquivo" on storage.objects;
drop policy if exists "arquivo: operador le todos"           on storage.objects;
drop policy if exists "arquivo: operador gerencia"           on storage.objects;

-- ENVIAR: só dentro da pasta com o próprio ID.
-- storage.foldername(name) devolve as pastas do caminho como lista;
-- a posição [1] é a primeira pasta — que precisa ser o ID do usuário.
create policy "arquivo: cliente envia na sua pasta"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'boletos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- LER/BAIXAR: cliente só a própria pasta.
create policy "arquivo: cliente le a sua pasta"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'boletos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SUBSTITUIR: cliente pode reenviar um arquivo dele.
create policy "arquivo: cliente troca o seu arquivo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'boletos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- LER/BAIXAR: operador acessa qualquer arquivo (é ele quem precisa baixar
-- o boleto ao clicar no clipinho da tabela).
create policy "arquivo: operador le todos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'boletos' and public.eh_admin());

create policy "arquivo: operador gerencia"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'boletos' and public.eh_admin())
  with check (bucket_id = 'boletos' and public.eh_admin());
