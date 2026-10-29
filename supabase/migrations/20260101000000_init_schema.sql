-- InvisioMZ · esquema inicial
-- Princípio: a base de dados guarda apenas METADADOS. Nunca senhas, chaves, mensagens, ficheiros em claro
-- nem nomes de ficheiros dos utilizadores.

create type public.operation_type   as enum ('hide', 'extract');
create type public.operation_status as enum ('success', 'failed');

-- ------------------------------------------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  created_at   timestamptz not null default now()
);

-- Cria o perfil automaticamente quando o utilizador se regista.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------------------------------------
-- operations (histórico: só metadados)
-- ------------------------------------------------------------------------------------------------
create table public.operations (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  type             public.operation_type   not null,
  status           public.operation_status not null,
  error_code       text check (error_code is null or error_code ~ '^[A-Z_]{3,40}$'),
  bits_per_channel smallint check (bits_per_channel is null or bits_per_channel in (1, 2)),
  image_width      integer  check (image_width  is null or image_width  > 0),
  image_height     integer  check (image_height is null or image_height > 0),
  payload_bytes    bigint   not null default 0 check (payload_bytes >= 0),
  file_count       integer  not null default 0 check (file_count >= 0),
  has_message      boolean  not null default false,
  duration_ms      integer  not null default 0 check (duration_ms >= 0),
  created_at       timestamptz not null default now()
);
create index operations_user_id_idx    on public.operations (user_id);
create index operations_user_created_idx on public.operations (user_id, created_at desc);
create index operations_created_at_idx on public.operations (created_at);

-- ------------------------------------------------------------------------------------------------
-- stego_files (PNG guardados no Storage; só úteis com a senha)
-- ------------------------------------------------------------------------------------------------
create table public.stego_files (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null references public.operations (id) on delete cascade,
  storage_path text not null unique
                 check (storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'),
  size_bytes   bigint not null check (size_bytes >= 0),
  sha256       text   not null check (sha256 ~ '^[0-9a-f]{64}$'),
  label        text   check (label is null or char_length(label) <= 80),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '7 days')
);
create index stego_files_user_id_idx      on public.stego_files (user_id);
create index stego_files_operation_id_idx on public.stego_files (operation_id);
create index stego_files_created_at_idx   on public.stego_files (created_at);
create index stego_files_expires_at_idx   on public.stego_files (expires_at);

-- ------------------------------------------------------------------------------------------------
-- audit_log (eventos de segurança; IP só como hash com sal)
-- ------------------------------------------------------------------------------------------------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete cascade,
  event      text not null check (event ~ '^[a-z_]{3,40}(:[A-Z_]{3,40})?$'),
  ip_hash    text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
create index audit_log_user_id_idx    on public.audit_log (user_id);
create index audit_log_created_at_idx on public.audit_log (created_at);

-- ------------------------------------------------------------------------------------------------
-- Row Level Security: activado em TODAS as tabelas
-- ------------------------------------------------------------------------------------------------
alter table public.profiles    enable row level security;
alter table public.operations  enable row level security;
alter table public.stego_files enable row level security;
alter table public.audit_log   enable row level security;

-- Privilégios mínimos (defesa em profundidade: mesmo sem RLS, `anon` não toca em nada).
revoke all on public.profiles, public.operations, public.stego_files, public.audit_log from anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, delete on public.operations, public.stego_files to authenticated;
-- audit_log: sem qualquer privilégio para anon/authenticated (só o service_role, via backend).

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- INSERT/UPDATE de operations e stego_files: só o backend (service_role ignora o RLS).
create policy operations_select_own on public.operations
  for select to authenticated using ((select auth.uid()) = user_id);
create policy operations_delete_own on public.operations
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy stego_files_select_own on public.stego_files
  for select to authenticated using ((select auth.uid()) = user_id);
create policy stego_files_delete_own on public.stego_files
  for delete to authenticated using ((select auth.uid()) = user_id);

-- audit_log: RLS activado e SEM políticas => ninguém (excepto service_role) lê ou escreve.
