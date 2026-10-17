-- ============================================================
-- NeJoAta — konfigurimi i Supabase për feed-in e denoncimeve
-- Hape Supabase → SQL Editor → ngjit gjithë këtë → Run.
-- Pastaj plotëso config.js me Project URL + anon key.
-- ============================================================

-- 1) Tabela e denoncimeve (vetëm metadata; videot rrinë në Storage)
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  video_url   text not null,
  storage_path text not null,
  description text,
  location    text
);

alter table public.reports enable row level security;

-- Kushdo (anon) mund të SHTOJË një denoncim
drop policy if exists "reports_insert_anon" on public.reports;
create policy "reports_insert_anon"
  on public.reports for insert
  to anon, authenticated
  with check (true);

-- Kushdo mund të LEXOJË feed-in
drop policy if exists "reports_select_public" on public.reports;
create policy "reports_select_public"
  on public.reports for select
  to anon, authenticated
  using (true);

-- (Qëllimisht: pa UPDATE/DELETE nga klienti. Fshirjen e bën vetëm admini.)

-- 2) Bucket-i për videot (publik për lexim)
insert into storage.buckets (id, name, public)
values ('videos', 'videos', true)
on conflict (id) do update set public = true;

-- Kushdo (anon) mund të NGARKOJË në bucket-in 'videos'
drop policy if exists "videos_upload_anon" on storage.objects;
create policy "videos_upload_anon"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'videos');

-- Kushdo mund të SHOHË videot
drop policy if exists "videos_read_public" on storage.objects;
create policy "videos_read_public"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'videos');

-- 3) Listat e personalizuara (të përbashkëta, online)
create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  columns    jsonb not null default '[]'::jsonb
);
create table if not exists public.list_rows (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  list_id    uuid not null references public.lists(id) on delete cascade,
  data       jsonb not null default '[]'::jsonb
);

alter table public.lists enable row level security;
alter table public.list_rows enable row level security;

drop policy if exists "lists_select_public" on public.lists;
create policy "lists_select_public" on public.lists for select to anon, authenticated using (true);
drop policy if exists "lists_insert_anon" on public.lists;
create policy "lists_insert_anon" on public.lists for insert to anon, authenticated with check (true);
drop policy if exists "lists_delete_anon" on public.lists;
create policy "lists_delete_anon" on public.lists for delete to anon, authenticated using (true);

drop policy if exists "rows_select_public" on public.list_rows;
create policy "rows_select_public" on public.list_rows for select to anon, authenticated using (true);
drop policy if exists "rows_insert_anon" on public.list_rows;
create policy "rows_insert_anon" on public.list_rows for insert to anon, authenticated with check (true);
drop policy if exists "rows_delete_anon" on public.list_rows;
create policy "rows_delete_anon" on public.list_rows for delete to anon, authenticated using (true);
-- Shënim: fshirja është e hapur për këdo (pa llogari). Nëse do ta mbyllësh,
-- hiq politikat "..._delete_anon" dhe fshirjen bëje vetëm nga dashboard-i.

-- 4) Realtime — që shtimi i emrave të përditësohet te të gjithë në çast
alter publication supabase_realtime add table public.list_rows;
alter publication supabase_realtime add table public.lists;
alter publication supabase_realtime add table public.reports;
-- (Nëse një tabelë është shtuar tashmë, Supabase jep gabim të padëmshëm — shpërfille.)

-- ============================================================
-- SIGURIA — lexoje:
-- • anon key vendoset në app (normale, mbrohet nga RLS). service_role NUK vihet kurrë.
-- • Ky server mban dëshmi që identifikon protestues. Është pikë që mund të
--   merret ose mbyllet. Mbaje qasjen minimale dhe fshi çfarë s'duhet.
-- • Për të kufizuar madhësinë/abuzimin, mund të shtosh limite në Supabase
--   (file size limits te bucket settings) dhe rate-limiting te një Edge Function.
-- ============================================================
