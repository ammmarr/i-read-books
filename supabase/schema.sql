-- I READ BOOKS — Supabase schema
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run (everything is "if not exists" / "or replace").
--
-- Model: every device keeps a local copy (IndexedDB) and syncs here.
--   updated_at  client clock (ms) — last write wins
--   server_ts   server clock (ms) — what devices pull by, immune to clock skew
--   deleted     soft-delete flag so other devices learn about deletions

-- ── helper: stamp server time, and never let an older write overwrite a newer one
create or replace function public.irb_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.server_ts := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  return new;
end $$;

-- ── books (and reading-list entries that don't have a PDF yet)
create table if not exists public.irb_books (
  id              uuid primary key,
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  title           text,
  author          text,
  file_name       text,
  file_size       bigint,
  fingerprint     text,
  page_count      int,
  page_sizes      jsonb,
  tint            text,
  added_at        bigint,
  last_opened_at  bigint,
  current_page    int,
  page_offset     double precision,
  furthest_page   int,
  status          text,
  queue_order     double precision,
  started_at      bigint,
  finished_at     bigint,
  file_path       text,
  cover_path      text,
  cover_url       text,
  source_url      text,
  est_pages       int,
  updated_at      bigint not null,
  server_ts       bigint,
  deleted         boolean not null default false
);

create table if not exists public.irb_highlights (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  book_id     uuid,
  page        int,
  color       text,
  text        text,
  note        text,
  rects       jsonb,
  created_at  bigint,
  updated_at  bigint not null,
  server_ts   bigint,
  deleted     boolean not null default false
);

create table if not exists public.irb_bookmarks (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  book_id     uuid,
  page        int,
  created_at  bigint,
  updated_at  bigint not null,
  server_ts   bigint,
  deleted     boolean not null default false
);

create table if not exists public.irb_sessions (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  book_id     uuid,
  start_ms    bigint,
  end_ms      bigint,
  seconds     int,
  pages       jsonb,
  updated_at  bigint not null,
  server_ts   bigint,
  deleted     boolean not null default false
);

create table if not exists public.irb_profiles (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  settings    jsonb,
  updated_at  bigint not null,
  server_ts   bigint
);

-- ── triggers, indexes, row-level security (only you can see your rows)
do $$
declare t text;
begin
  foreach t in array array['irb_books', 'irb_highlights', 'irb_bookmarks', 'irb_sessions', 'irb_profiles'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before insert or update on public.%1$s for each row execute function public.irb_touch()', t);
    execute format('create index if not exists %1$s_user_ts on public.%1$s (user_id, server_ts)', t);
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%1$s', t);
    execute format('create policy "own rows" on public.%1$s for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ── storage: one private bucket, one folder per user  ({user_id}/{book_id}.pdf|.jpg)
insert into storage.buckets (id, name, public)
values ('irb-books', 'irb-books', false)
on conflict (id) do nothing;

drop policy if exists "irb own files read" on storage.objects;
drop policy if exists "irb own files write" on storage.objects;
drop policy if exists "irb own files update" on storage.objects;
drop policy if exists "irb own files delete" on storage.objects;

create policy "irb own files read" on storage.objects for select to authenticated
  using (bucket_id = 'irb-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "irb own files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'irb-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "irb own files update" on storage.objects for update to authenticated
  using (bucket_id = 'irb-books' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "irb own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'irb-books' and (storage.foldername(name))[1] = auth.uid()::text);
