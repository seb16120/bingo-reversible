-- Bingo réversible Online — fondation du lobby privé à deux joueurs.
-- À exécuter dans Supabase > SQL Editor.
-- Cette première migration couvre : création, invitation, rejoindre, état prêt,
-- reconnexion/heartbeat et Realtime. Le plateau synchronisé sera ajouté ensuite.

create extension if not exists pgcrypto;

create table if not exists public.online_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'active', 'finished')),
  series_length smallint not null default 3 check (series_length in (1, 3, 5)),
  timers_enabled boolean not null default false,
  debug_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.online_room_players (
  room_id uuid not null references public.online_rooms(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  user_id uuid not null references auth.users(id) on delete cascade,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, user_id)
);

create index if not exists online_room_players_user_idx
  on public.online_room_players(user_id);

create index if not exists online_room_players_seen_idx
  on public.online_room_players(room_id, last_seen desc);

create or replace function public.online_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists online_rooms_touch_updated_at on public.online_rooms;
create trigger online_rooms_touch_updated_at
before update on public.online_rooms
for each row execute function public.online_touch_updated_at();

alter table public.online_rooms enable row level security;
alter table public.online_room_players enable row level security;

-- Helper SECURITY DEFINER : évite la récursion des politiques RLS sur la table
-- des joueurs et ne révèle aucune donnée supplémentaire.
create or replace function public.online_is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.online_room_players
    where room_id = p_room_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.online_is_room_member(uuid) from public;
grant execute on function public.online_is_room_member(uuid) to authenticated;

-- Les clients lisent uniquement les salons dont ils sont membres.
drop policy if exists online_rooms_members_select on public.online_rooms;
create policy online_rooms_members_select
on public.online_rooms
for select
to authenticated
using (public.online_is_room_member(id));

-- Les membres d'un salon voient les deux places, mais pas d'autres salons.
drop policy if exists online_players_members_select on public.online_room_players;
create policy online_players_members_select
on public.online_room_players
for select
to authenticated
using (public.online_is_room_member(room_id));

-- Aucun INSERT/UPDATE/DELETE direct n'est autorisé aux clients.
-- Toutes les écritures passent par les RPC SECURITY DEFINER ci-dessous.
revoke all on public.online_rooms from anon, authenticated;
revoke all on public.online_room_players from anon, authenticated;
grant select on public.online_rooms to authenticated;
grant select on public.online_room_players to authenticated;

create or replace function public.online_random_room_code()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text := '';
  i integer;
begin
  for i in 1..6 loop
    candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return candidate;
end;
$$;

revoke all on function public.online_random_room_code() from public;

create or replace function public.create_online_room(
  p_series_length smallint default 3,
  p_timers_enabled boolean default false,
  p_debug_enabled boolean default false
)
returns table(room_id uuid, code text, seat smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room_id uuid;
  v_code text;
  attempt integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_series_length not in (1, 3, 5) then
    raise exception 'INVALID_SERIES_LENGTH';
  end if;

  loop
    attempt := attempt + 1;
    if attempt > 30 then
      raise exception 'ROOM_CODE_GENERATION_FAILED';
    end if;

    v_code := public.online_random_room_code();
    begin
      insert into public.online_rooms (
        code,
        host_id,
        series_length,
        timers_enabled,
        debug_enabled
      ) values (
        v_code,
        v_user,
        p_series_length,
        coalesce(p_timers_enabled, false),
        coalesce(p_debug_enabled, false)
      ) returning id into v_room_id;
      exit;
    exception when unique_violation then
      -- Rare collision : génère un nouveau code.
    end;
  end loop;

  insert into public.online_room_players(room_id, seat, user_id, ready)
  values (v_room_id, 1, v_user, false);

  return query select v_room_id, v_code, 1::smallint;
end;
$$;

create or replace function public.join_online_room(p_code text)
returns table(room_id uuid, code text, seat smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room public.online_rooms%rowtype;
  v_existing_seat smallint;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_room
  from public.online_rooms
  where code = upper(trim(p_code))
  for update;

  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select p.seat into v_existing_seat
  from public.online_room_players p
  where p.room_id = v_room.id and p.user_id = v_user;

  if found then
    update public.online_room_players
    set last_seen = now()
    where room_id = v_room.id and user_id = v_user;
    return query select v_room.id, v_room.code, v_existing_seat;
    return;
  end if;

  if v_room.status not in ('waiting', 'ready') then
    raise exception 'ROOM_ALREADY_STARTED';
  end if;

  if exists (
    select 1 from public.online_room_players
    where online_room_players.room_id = v_room.id and online_room_players.seat = 2
  ) then
    raise exception 'ROOM_FULL';
  end if;

  insert into public.online_room_players(room_id, seat, user_id, ready)
  values (v_room.id, 2, v_user, false);

  update public.online_rooms
  set status = 'waiting'
  where id = v_room.id;

  return query select v_room.id, v_room.code, 2::smallint;
end;
$$;

create or replace function public.set_online_ready(
  p_room_id uuid,
  p_ready boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_member_count integer;
  v_ready_count integer;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.online_room_players
  set ready = coalesce(p_ready, false), last_seen = now()
  where room_id = p_room_id and user_id = v_user;

  if not found then
    raise exception 'NOT_A_ROOM_MEMBER';
  end if;

  select count(*), count(*) filter (where ready)
  into v_member_count, v_ready_count
  from public.online_room_players
  where room_id = p_room_id;

  update public.online_rooms
  set status = case
    when v_member_count = 2 and v_ready_count = 2 then 'ready'
    else 'waiting'
  end
  where id = p_room_id and status in ('waiting', 'ready');
end;
$$;

create or replace function public.touch_online_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.online_room_players
  set last_seen = now()
  where room_id = p_room_id and user_id = auth.uid();

  if not found then
    raise exception 'NOT_A_ROOM_MEMBER';
  end if;
end;
$$;

revoke all on function public.create_online_room(smallint, boolean, boolean) from public;
revoke all on function public.join_online_room(text) from public;
revoke all on function public.set_online_ready(uuid, boolean) from public;
revoke all on function public.touch_online_room(uuid) from public;

grant execute on function public.create_online_room(smallint, boolean, boolean) to authenticated;
grant execute on function public.join_online_room(text) to authenticated;
grant execute on function public.set_online_ready(uuid, boolean) to authenticated;
grant execute on function public.touch_online_room(uuid) to authenticated;

-- Active les changements Postgres pour les deux tables sans provoquer
-- d'erreur si la migration est rejouée.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_rooms'
  ) then
    alter publication supabase_realtime add table public.online_rooms;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'online_room_players'
  ) then
    alter publication supabase_realtime add table public.online_room_players;
  end if;
end;
$$;
