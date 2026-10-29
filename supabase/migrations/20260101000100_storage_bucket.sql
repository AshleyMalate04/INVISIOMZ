-- Bucket privado para os PNG esteganográficos guardados no histórico.
-- Caminho: {user_id}/{uuid}.png · só PNG · descarga apenas por URL assinada de curta duração (gerada pelo backend).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stego-results', 'stego-results', false, 67108864, array['image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- O utilizador só vê/apaga ficheiros da SUA pasta. Não há política de INSERT/UPDATE para `authenticated`:
-- os uploads fazem-se exclusivamente pelo backend (service_role), depois de gerar e verificar o PNG.
create policy "stego_results_select_own_folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'stego-results' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "stego_results_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'stego-results' and (storage.foldername(name))[1] = (select auth.uid())::text);
