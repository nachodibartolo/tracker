-- Bucket privado para fotos de recibos

insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

create policy "own receipts read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "own receipts write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "own receipts update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "own receipts delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
