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
  position_at     bigint,
  furthest_page   int,
  read_pages      text,
  read_pages_set_at bigint,
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

-- chapter recaps: your three answers after each chapter (id = "{book_id}:{first page}")
create table if not exists public.irb_recaps (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  book_id     uuid,
  start_page  int,
  end_page    int,
  chapter     text,
  sections    jsonb,
  answers     jsonb,
  state       text,
  created_at  bigint,
  reviewed_at bigint,
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

-- (for projects created before read_pages existed)
alter table public.irb_books add column if not exists read_pages text;
alter table public.irb_books add column if not exists read_pages_set_at bigint;
alter table public.irb_books add column if not exists position_at bigint;

-- ── triggers, indexes, row-level security (only you can see your rows)
do $$
declare t text;
begin
  foreach t in array array['irb_books', 'irb_highlights', 'irb_bookmarks', 'irb_sessions', 'irb_recaps', 'irb_profiles'] loop
    execute format('drop trigger if exists %1$s_touch on public.%1$s', t);
    execute format('create trigger %1$s_touch before insert or update on public.%1$s for each row execute function public.irb_touch()', t);
    execute format('create index if not exists %1$s_user_ts on public.%1$s (user_id, server_ts)', t);
    execute format('alter table public.%1$s enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%1$s', t);
    execute format('create policy "own rows" on public.%1$s for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

-- ── progress set by hand wins over stale devices
-- A device that hasn't synced a manual "Edit progress" yet can't overwrite it
-- with its older pages-read; it adopts the new progress on its next pull.
create or replace function public.irb_books_keep_manual_progress() returns trigger
language plpgsql as $$
begin
  if old.read_pages_set_at is not null
     and (new.read_pages_set_at is null or new.read_pages_set_at < old.read_pages_set_at) then
    new.read_pages := old.read_pages;
    new.read_pages_set_at := old.read_pages_set_at;
    new.furthest_page := old.furthest_page;
  end if;
  -- Reading position: the device that moved most recently wins, even if
  -- another device saved some other change to the book afterwards.
  if old.position_at is not null and (new.position_at is null or new.position_at < old.position_at) then
    new.current_page := old.current_page;
    new.page_offset := old.page_offset;
    new.position_at := old.position_at;
  end if;
  return new;
end $$;
drop trigger if exists irb_books_manual_progress on public.irb_books;
create trigger irb_books_manual_progress before update on public.irb_books
  for each row execute function public.irb_books_keep_manual_progress();

-- ── a written recap is never wiped out by a device that only noted the
-- chapter as finished (or skipped it) before it had synced your answers
create or replace function public.irb_recaps_keep_answers() returns trigger
language plpgsql as $$
begin
  if not new.deleted
     and coalesce(new.answers, '{}'::jsonb) = '{}'::jsonb
     and coalesce(old.answers, '{}'::jsonb) <> '{}'::jsonb then
    new.answers := old.answers;
    new.state := old.state;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end $$;
drop trigger if exists irb_recaps_keep_answers on public.irb_recaps;
create trigger irb_recaps_keep_answers before update on public.irb_recaps
  for each row execute function public.irb_recaps_keep_answers();

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

-- ── delete my account (called from Settings → Delete account)
-- The app empties your storage folder first (storage rows can only be removed
-- through the Storage API); deleting the auth user then cascades to every
-- irb_* table above.
create or replace function public.irb_delete_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.irb_delete_account() from public, anon;
grant execute on function public.irb_delete_account() to authenticated;
