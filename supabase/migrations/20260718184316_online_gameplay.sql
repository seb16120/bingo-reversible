-- Jeu Online autoritaire : plateau, couleurs secrètes, manches et reconnexion.
-- Les clients ne modifient jamais les tables directement : toutes les écritures
-- passent par des RPC qui vérifient l'identité, le tour et la légalité du coup.

create table public.online_games (
  room_id uuid primary key references public.online_rooms(id) on delete cascade,
  phase text not null default 'playing'
    check (phase in ('playing', 'round_finished', 'next_countdown', 'match_finished')),
  round_number integer not null default 1 check (round_number >= 1),
  starter_seat smallint not null check (starter_seat in (1, 2)),
  current_seat smallint check (current_seat in (1, 2)),
  board jsonb not null default '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb
    check (jsonb_typeof(board) = 'array' and jsonb_array_length(board) = 16),
  reserves jsonb not null default '[{"rb":3,"yr":3,"by":3},{"rb":3,"yr":3,"by":3}]'::jsonb
    check (jsonb_typeof(reserves) = 'array' and jsonb_array_length(reserves) = 2),
  protected_index smallint check (protected_index between 0 and 15),
  move_number integer not null default 0 check (move_number between 0 and 50),
  position_counts jsonb not null default '{}'::jsonb,
  scores smallint[] not null default array[0, 0]::smallint[]
    check (cardinality(scores) = 2 and scores[1] >= 0 and scores[2] >= 0),
  round_result text check (round_result in ('win', 'draw', 'forfeit', 'timeout', 'disconnect', 'series_forfeit')),
  round_winner smallint check (round_winner in (1, 2)),
  round_reason text,
  winning_line smallint[],
  revealed_colors jsonb,
  next_ready_seats smallint[] not null default '{}'::smallint[],
  next_countdown_started_at timestamptz,
  turn_started_at timestamptz not null default now(),
  time_left_ms bigint[] not null default array[1800000, 1800000]::bigint[]
    check (cardinality(time_left_ms) = 2 and time_left_ms[1] >= 0 and time_left_ms[2] >= 0),
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists online_rooms_host_idx on public.online_rooms(host_id);

create table public.online_player_secrets (
  room_id uuid not null references public.online_rooms(id) on delete cascade,
  round_number integer not null check (round_number >= 1),
  seat smallint not null check (seat in (1, 2)),
  user_id uuid not null references auth.users(id) on delete cascade,
  color text not null check (color in ('red', 'blue', 'yellow')),
  created_at timestamptz not null default now(),
  primary key (room_id, round_number, seat),
  unique (room_id, round_number, user_id)
);

create index online_player_secrets_user_idx
  on public.online_player_secrets(user_id, room_id, round_number);

create trigger online_games_touch_updated_at
before update on public.online_games
for each row execute function public.online_touch_updated_at();

alter table public.online_games enable row level security;
alter table public.online_player_secrets enable row level security;

create policy online_games_members_select
on public.online_games
for select
to authenticated
using (public.online_is_room_member(room_id));

create policy online_secrets_own_select
on public.online_player_secrets
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.online_games from anon, authenticated;
revoke all on public.online_player_secrets from anon, authenticated;
grant select on public.online_games to authenticated;
grant select on public.online_player_secrets to authenticated;

create or replace function public.online_member_seat(p_room_id uuid)
returns smallint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_seat smallint;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select p.seat into v_seat
  from public.online_room_players p
  where p.room_id = p_room_id and p.user_id = v_user;

  if v_seat is null then
    raise exception 'NOT_A_ROOM_MEMBER';
  end if;
  return v_seat;
end;
$$;

revoke all on function public.online_member_seat(uuid) from public, anon, authenticated;

create or replace function public.online_tile_center(p_tile jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_tile->>'type'
    when 'rb' then case (p_tile->>'face')::integer when 0 then 'red' else 'blue' end
    when 'yr' then case (p_tile->>'face')::integer when 0 then 'yellow' else 'red' end
    when 'by' then case (p_tile->>'face')::integer when 0 then 'blue' else 'yellow' end
    else null
  end;
$$;

revoke all on function public.online_tile_center(jsonb) from public, anon, authenticated;

create or replace function public.online_find_winner(
  p_room_id uuid,
  p_round_number integer,
  p_board jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_lines integer[][] := array[
    [0,1,2,3], [4,5,6,7], [8,9,10,11], [12,13,14,15],
    [0,4,8,12], [1,5,9,13], [2,6,10,14], [3,7,11,15],
    [0,5,10,15], [3,6,9,12]
  ];
  v_line integer[];
  v_seat smallint;
  v_color text;
  v_won boolean;
begin
  for v_seat in 1..2 loop
    select s.color into v_color
    from public.online_player_secrets s
    where s.room_id = p_room_id
      and s.round_number = p_round_number
      and s.seat = v_seat;

    foreach v_line slice 1 in array v_lines loop
      select bool_and(
        p_board->i <> 'null'::jsonb
        and public.online_tile_center(p_board->i) = v_color
      ) into v_won
      from unnest(v_line) as i;

      if coalesce(v_won, false) then
        return jsonb_build_object('seat', v_seat, 'color', v_color, 'line', to_jsonb(v_line));
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

revoke all on function public.online_find_winner(uuid, integer, jsonb) from public, anon, authenticated;

create or replace function public.online_start_round(
  p_room_id uuid,
  p_starter_seat smallint,
  p_round_number integer,
  p_scores smallint[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_colors text[] := array['red', 'blue', 'yellow'];
  v_first integer := 1 + floor(random() * 3)::integer;
  v_second integer;
  v_player_1 uuid;
  v_player_2 uuid;
begin
  if p_starter_seat not in (1, 2) then
    raise exception 'INVALID_STARTER';
  end if;

  select p.user_id into v_player_1
  from public.online_room_players p
  where p.room_id = p_room_id and p.seat = 1;
  select p.user_id into v_player_2
  from public.online_room_players p
  where p.room_id = p_room_id and p.seat = 2;

  if v_player_1 is null or v_player_2 is null then
    raise exception 'ROOM_NEEDS_TWO_PLAYERS';
  end if;

  v_second := 1 + ((v_first - 1 + 1 + floor(random() * 2)::integer) % 3);

  delete from public.online_player_secrets s
  where s.room_id = p_room_id and s.round_number = p_round_number;

  insert into public.online_player_secrets(room_id, round_number, seat, user_id, color)
  values
    (p_room_id, p_round_number, 1, v_player_1, v_colors[v_first]),
    (p_room_id, p_round_number, 2, v_player_2, v_colors[v_second]);

  insert into public.online_games (
    room_id, phase, round_number, starter_seat, current_seat, board, reserves,
    protected_index, move_number, position_counts, scores, round_result,
    round_winner, round_reason, winning_line, revealed_colors, next_ready_seats,
    next_countdown_started_at, turn_started_at, time_left_ms, version
  ) values (
    p_room_id, 'playing', p_round_number, p_starter_seat, p_starter_seat,
    '[null,null,null,null,null,null,null,null,null,null,null,null,null,null,null,null]'::jsonb,
    '[{"rb":3,"yr":3,"by":3},{"rb":3,"yr":3,"by":3}]'::jsonb,
    null, 0, '{}'::jsonb, p_scores, null, null, null, null, null,
    '{}'::smallint[], null, now(), array[1800000, 1800000]::bigint[], 1
  )
  on conflict (room_id) do update set
    phase = excluded.phase,
    round_number = excluded.round_number,
    starter_seat = excluded.starter_seat,
    current_seat = excluded.current_seat,
    board = excluded.board,
    reserves = excluded.reserves,
    protected_index = null,
    move_number = 0,
    position_counts = '{}'::jsonb,
    scores = excluded.scores,
    round_result = null,
    round_winner = null,
    round_reason = null,
    winning_line = null,
    revealed_colors = null,
    next_ready_seats = '{}'::smallint[],
    next_countdown_started_at = null,
    turn_started_at = now(),
    time_left_ms = array[1800000, 1800000]::bigint[],
    version = public.online_games.version + 1;
end;
$$;

revoke all on function public.online_start_round(uuid, smallint, integer, smallint[]) from public, anon, authenticated;

create or replace function public.online_finish_round(
  p_room_id uuid,
  p_winner smallint,
  p_result text,
  p_reason text,
  p_winning_line smallint[] default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game public.online_games%rowtype;
  v_room public.online_rooms%rowtype;
  v_scores smallint[];
  v_target integer;
  v_match_finished boolean := false;
  v_colors jsonb;
begin
  if p_result not in ('win', 'draw', 'forfeit', 'timeout', 'disconnect', 'series_forfeit') then
    raise exception 'INVALID_ROUND_RESULT';
  end if;
  if p_winner is not null and p_winner not in (1, 2) then
    raise exception 'INVALID_WINNER';
  end if;

  select * into v_game from public.online_games g
  where g.room_id = p_room_id for update;
  select * into v_room from public.online_rooms r
  where r.id = p_room_id;

  if v_game.phase <> 'playing' then
    return;
  end if;

  v_scores := v_game.scores;
  if p_winner is not null then
    v_scores[p_winner] := v_scores[p_winner] + 1;
  end if;
  v_target := (v_room.series_length / 2) + 1;
  v_match_finished := p_result = 'series_forfeit'
    or v_scores[1] >= v_target
    or v_scores[2] >= v_target;

  select jsonb_object_agg(s.seat::text, s.color order by s.seat)
  into v_colors
  from public.online_player_secrets s
  where s.room_id = p_room_id and s.round_number = v_game.round_number;

  update public.online_games g set
    phase = case when v_match_finished then 'match_finished' else 'round_finished' end,
    current_seat = null,
    scores = v_scores,
    round_result = p_result,
    round_winner = p_winner,
    round_reason = p_reason,
    winning_line = p_winning_line,
    revealed_colors = v_colors,
    next_ready_seats = '{}'::smallint[],
    next_countdown_started_at = null,
    version = g.version + 1
  where g.room_id = p_room_id;

  if v_match_finished then
    update public.online_rooms r set status = 'finished' where r.id = p_room_id;
  end if;
end;
$$;

revoke all on function public.online_finish_round(uuid, smallint, text, text, smallint[]) from public, anon, authenticated;

create or replace function public.online_apply_game_deadlines(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_game public.online_games%rowtype;
  v_room public.online_rooms%rowtype;
  v_stale_seat smallint;
  v_connected integer;
  v_elapsed_ms bigint;
  v_limit_ms bigint;
begin
  select * into v_game from public.online_games g
  where g.room_id = p_room_id for update;
  if not found or v_game.phase = 'match_finished' then return; end if;

  if v_game.phase = 'next_countdown' then
    select count(*) filter (where p.last_seen >= now() - interval '8 seconds')
    into v_connected
    from public.online_room_players p where p.room_id = p_room_id;
    if v_connected <> 2 then
      update public.online_games g set
        phase = 'round_finished',
        next_ready_seats = '{}'::smallint[],
        next_countdown_started_at = null,
        version = g.version + 1
      where g.room_id = p_room_id;
    end if;
    return;
  end if;

  if v_game.phase <> 'playing' then return; end if;

  select p.seat into v_stale_seat
  from public.online_room_players p
  where p.room_id = p_room_id
    and p.last_seen < now() - interval '45 seconds'
  order by p.last_seen
  limit 1;

  if v_stale_seat is not null then
    perform public.online_finish_round(
      p_room_id,
      (3 - v_stale_seat)::smallint,
      'disconnect',
      format('Le joueur %s ne s''est pas reconnecté dans les 45 secondes.', v_stale_seat),
      null
    );
    return;
  end if;

  select * into v_room from public.online_rooms r where r.id = p_room_id;
  if v_room.timers_enabled then
    v_elapsed_ms := greatest(0, floor(extract(epoch from (clock_timestamp() - v_game.turn_started_at)) * 1000)::bigint);
    v_limit_ms := least(60000::bigint, v_game.time_left_ms[v_game.current_seat]);
    if v_elapsed_ms >= v_limit_ms then
      perform public.online_finish_round(
        p_room_id,
        (3 - v_game.current_seat)::smallint,
        'timeout',
        case when v_game.time_left_ms[v_game.current_seat] <= 60000
          then format('Le joueur %s a épuisé ses 30 minutes.', v_game.current_seat)
          else format('Le joueur %s a dépassé une minute pour son coup.', v_game.current_seat)
        end,
        null
      );
    end if;
  end if;
end;
$$;

revoke all on function public.online_apply_game_deadlines(uuid) from public, anon, authenticated;

create or replace function public.start_online_room_after_countdown(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid := auth.uid();
  v_room public.online_rooms%rowtype;
  v_member_count integer;
  v_ready_count integer;
  v_connected_count integer;
  v_starter smallint;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.online_member_seat(p_room_id);

  select * into v_room from public.online_rooms r
  where r.id = p_room_id for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  if v_room.status = 'active' then
    if not exists (select 1 from public.online_games g where g.room_id = p_room_id) then
      v_starter := (1 + floor(random() * 2))::smallint;
      perform public.online_start_round(p_room_id, v_starter, 1, array[0,0]::smallint[]);
    end if;
    return true;
  end if;

  select count(*), count(*) filter (where p.ready),
         count(*) filter (where p.last_seen >= now() - interval '8 seconds')
  into v_member_count, v_ready_count, v_connected_count
  from public.online_room_players p where p.room_id = p_room_id;

  if v_member_count <> 2 or v_ready_count <> 2 or v_connected_count <> 2
     or v_room.countdown_started_at is null
     or now() < v_room.countdown_started_at + interval '5 seconds' then
    if v_ready_count <> 2 or v_connected_count <> 2 then
      update public.online_rooms r set status = 'waiting', countdown_started_at = null
      where r.id = p_room_id and r.status in ('waiting', 'ready');
    end if;
    return false;
  end if;

  update public.online_rooms r set
    status = 'active', started_at = now(), countdown_started_at = null
  where r.id = p_room_id;

  v_starter := (1 + floor(random() * 2))::smallint;
  perform public.online_start_round(p_room_id, v_starter, 1, array[0,0]::smallint[]);
  return true;
end;
$$;

revoke all on function public.start_online_room_after_countdown(uuid) from public, anon;
grant execute on function public.start_online_room_after_countdown(uuid) to authenticated;

create or replace function public.cancel_online_countdown(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.online_member_seat(p_room_id);
  update public.online_rooms r set status = 'waiting', countdown_started_at = null
  where r.id = p_room_id and r.status = 'ready';
  if found then
    update public.online_room_players p set ready = false where p.room_id = p_room_id;
  end if;
end;
$$;

revoke all on function public.cancel_online_countdown(uuid) from public, anon;
grant execute on function public.cancel_online_countdown(uuid) to authenticated;

create or replace function public.touch_online_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.online_room_players p set last_seen = now()
  where p.room_id = p_room_id and p.user_id = auth.uid();
  if not found then raise exception 'NOT_A_ROOM_MEMBER'; end if;
  perform public.online_apply_game_deadlines(p_room_id);
end;
$$;

revoke all on function public.touch_online_room(uuid) from public, anon;
grant execute on function public.touch_online_room(uuid) to authenticated;

create or replace function public.get_online_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_game public.online_games%rowtype;
  v_secret text;
  v_opponent_seen timestamptz;
begin
  v_seat := public.online_member_seat(p_room_id);
  perform public.online_apply_game_deadlines(p_room_id);
  select * into v_game from public.online_games g where g.room_id = p_room_id;
  if not found then raise exception 'GAME_NOT_READY'; end if;
  select s.color into v_secret from public.online_player_secrets s
  where s.room_id = p_room_id and s.round_number = v_game.round_number and s.seat = v_seat;
  select p.last_seen into v_opponent_seen from public.online_room_players p
  where p.room_id = p_room_id and p.seat = 3 - v_seat;

  return jsonb_build_object(
    'game', to_jsonb(v_game) - 'position_counts',
    'seat', v_seat,
    'secret_color', v_secret,
    'opponent_last_seen', v_opponent_seen,
    'server_now', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_online_game(uuid) from public, anon;
grant execute on function public.get_online_game(uuid) to authenticated;

create or replace function public.play_online_move(
  p_room_id uuid,
  p_expected_version bigint,
  p_action text,
  p_index smallint default null,
  p_from smallint default null,
  p_to smallint default null,
  p_tile_type text default null,
  p_face smallint default null
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_game public.online_games%rowtype;
  v_room public.online_rooms%rowtype;
  v_board jsonb;
  v_reserves jsonb;
  v_times bigint[];
  v_empty_count integer;
  v_played_index smallint;
  v_tile jsonb;
  v_count integer;
  v_elapsed_ms bigint := 0;
  v_winner jsonb;
  v_next_seat smallint;
  v_position_key text;
  v_repetitions integer;
begin
  v_seat := public.online_member_seat(p_room_id);
  update public.online_room_players p set last_seen = now()
  where p.room_id = p_room_id and p.user_id = auth.uid();
  perform public.online_apply_game_deadlines(p_room_id);

  select * into v_game from public.online_games g
  where g.room_id = p_room_id for update;
  if v_game.phase <> 'playing' then return v_game.version; end if;
  if v_game.version <> p_expected_version then raise exception 'STALE_GAME_STATE'; end if;
  if v_game.current_seat <> v_seat then raise exception 'NOT_YOUR_TURN'; end if;

  select * into v_room from public.online_rooms r where r.id = p_room_id;
  v_board := v_game.board;
  v_reserves := v_game.reserves;
  v_times := v_game.time_left_ms;

  if v_room.timers_enabled then
    v_elapsed_ms := greatest(0, floor(extract(epoch from (clock_timestamp() - v_game.turn_started_at)) * 1000)::bigint);
    if v_elapsed_ms >= least(60000::bigint, v_times[v_seat]) then
      perform public.online_apply_game_deadlines(p_room_id);
      select g.version into p_expected_version
      from public.online_games g where g.room_id = p_room_id;
      return p_expected_version;
    end if;
    v_times[v_seat] := greatest(0, v_times[v_seat] - v_elapsed_ms);
  end if;

  select count(*) into v_empty_count
  from jsonb_array_elements(v_board) e(value) where e.value = 'null'::jsonb;
  if v_empty_count > 2 and p_action <> 'place' then raise exception 'PLACE_REQUIRED'; end if;

  if p_action = 'place' then
    if p_index is null or p_index not between 0 and 15 then raise exception 'INVALID_INDEX'; end if;
    if p_tile_type not in ('rb', 'yr', 'by') or p_face not in (0, 1) then raise exception 'INVALID_TILE'; end if;
    if v_board->p_index <> 'null'::jsonb then raise exception 'CELL_OCCUPIED'; end if;
    v_count := coalesce((v_reserves->(v_seat - 1)->>p_tile_type)::integer, 0);
    if v_count <= 0 then raise exception 'NO_TILE_LEFT'; end if;
    v_tile := jsonb_build_object('type', p_tile_type, 'face', p_face, 'owner', v_seat);
    v_board := jsonb_set(v_board, array[p_index::text], v_tile);
    v_reserves := jsonb_set(v_reserves, array[(v_seat - 1)::text, p_tile_type], to_jsonb(v_count - 1));
    v_played_index := p_index;
  elsif p_action = 'flip' then
    if p_index is null or p_index not between 0 and 15 then raise exception 'INVALID_INDEX'; end if;
    if v_empty_count > 2 then raise exception 'PLACE_REQUIRED'; end if;
    if p_index = v_game.protected_index then raise exception 'TILE_PROTECTED'; end if;
    v_tile := v_board->p_index;
    if v_tile = 'null'::jsonb then raise exception 'EMPTY_CELL'; end if;
    v_tile := jsonb_set(v_tile, '{face}', to_jsonb(1 - (v_tile->>'face')::integer));
    v_board := jsonb_set(v_board, array[p_index::text], v_tile);
    v_played_index := p_index;
  elsif p_action = 'move' then
    if p_from is null or p_to is null or p_from not between 0 and 15 or p_to not between 0 and 15 then
      raise exception 'INVALID_INDEX';
    end if;
    if v_empty_count > 2 then raise exception 'PLACE_REQUIRED'; end if;
    if p_from = v_game.protected_index then raise exception 'TILE_PROTECTED'; end if;
    if v_board->p_from = 'null'::jsonb then raise exception 'EMPTY_SOURCE'; end if;
    if v_board->p_to <> 'null'::jsonb then raise exception 'DESTINATION_OCCUPIED'; end if;
    if abs((p_from / 4) - (p_to / 4)) + abs((p_from % 4) - (p_to % 4)) <> 1 then
      raise exception 'DESTINATION_NOT_ADJACENT';
    end if;
    v_board := jsonb_set(v_board, array[p_to::text], v_board->p_from);
    v_board := jsonb_set(v_board, array[p_from::text], 'null'::jsonb);
    v_played_index := p_to;
  else
    raise exception 'INVALID_ACTION';
  end if;

  update public.online_games g set
    board = v_board,
    reserves = v_reserves,
    protected_index = v_played_index,
    move_number = g.move_number + 1,
    time_left_ms = v_times,
    version = g.version + 1
  where g.room_id = p_room_id
  returning * into v_game;

  v_winner := public.online_find_winner(p_room_id, v_game.round_number, v_board);
  if v_winner is not null then
    perform public.online_finish_round(
      p_room_id,
      (v_winner->>'seat')::smallint,
      'win',
      format('Quatre centres %s sont alignés.', v_winner->>'color'),
      array(select jsonb_array_elements_text(v_winner->'line')::smallint)
    );
  elsif v_game.move_number >= 50 then
    perform public.online_finish_round(p_room_id, null, 'draw', 'Aucun joueur n''a gagné après 50 coups.', null);
  else
    v_next_seat := (3 - v_seat)::smallint;
    v_position_key := v_board::text || ';r=' || v_reserves::text || ';p=' || v_next_seat::text
      || ';x=' || coalesce(v_played_index::text, '-');
    v_repetitions := coalesce((v_game.position_counts->>v_position_key)::integer, 0) + 1;
    update public.online_games g set
      current_seat = v_next_seat,
      position_counts = jsonb_set(g.position_counts, array[v_position_key], to_jsonb(v_repetitions)),
      turn_started_at = now(),
      version = g.version + 1
    where g.room_id = p_room_id;
    if v_repetitions >= 3 then
      perform public.online_finish_round(p_room_id, null, 'draw', 'La même position complète est apparue trois fois.', null);
    end if;
  end if;

  select g.version into p_expected_version from public.online_games g where g.room_id = p_room_id;
  return p_expected_version;
end;
$$;

revoke all on function public.play_online_move(uuid, bigint, text, smallint, smallint, smallint, text, smallint) from public, anon;
grant execute on function public.play_online_move(uuid, bigint, text, smallint, smallint, smallint, text, smallint) to authenticated;

create or replace function public.set_online_next_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_game public.online_games%rowtype;
  v_ready smallint[];
begin
  v_seat := public.online_member_seat(p_room_id);
  update public.online_room_players p set last_seen = now()
  where p.room_id = p_room_id and p.user_id = auth.uid();
  select * into v_game from public.online_games g where g.room_id = p_room_id for update;
  if v_game.phase not in ('round_finished', 'next_countdown') then raise exception 'ROUND_NOT_FINISHED'; end if;

  v_ready := array_remove(v_game.next_ready_seats, v_seat);
  if coalesce(p_ready, false) then v_ready := array_append(v_ready, v_seat); end if;

  update public.online_games g set
    next_ready_seats = v_ready,
    phase = case when cardinality(v_ready) = 2 then 'next_countdown' else 'round_finished' end,
    next_countdown_started_at = case when cardinality(v_ready) = 2
      then coalesce(g.next_countdown_started_at, now()) else null end,
    version = g.version + 1
  where g.room_id = p_room_id;
end;
$$;

revoke all on function public.set_online_next_ready(uuid, boolean) from public, anon;
grant execute on function public.set_online_next_ready(uuid, boolean) to authenticated;

create or replace function public.start_online_next_round_after_countdown(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_game public.online_games%rowtype;
  v_connected integer;
begin
  v_seat := public.online_member_seat(p_room_id);
  select * into v_game from public.online_games g where g.room_id = p_room_id for update;
  if v_game.phase = 'playing' then return true; end if;
  if v_game.phase <> 'next_countdown' or cardinality(v_game.next_ready_seats) <> 2
     or v_game.next_countdown_started_at is null
     or now() < v_game.next_countdown_started_at + interval '5 seconds' then return false; end if;

  select count(*) filter (where p.last_seen >= now() - interval '8 seconds')
  into v_connected from public.online_room_players p where p.room_id = p_room_id;
  if v_connected <> 2 then
    update public.online_games g set phase = 'round_finished', next_ready_seats = '{}'::smallint[],
      next_countdown_started_at = null, version = g.version + 1 where g.room_id = p_room_id;
    return false;
  end if;

  perform public.online_start_round(
    p_room_id,
    (3 - v_game.starter_seat)::smallint,
    v_game.round_number + 1,
    v_game.scores
  );
  return true;
end;
$$;

revoke all on function public.start_online_next_round_after_countdown(uuid) from public, anon;
grant execute on function public.start_online_next_round_after_countdown(uuid) to authenticated;

create or replace function public.forfeit_online_round(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_seat smallint;
begin
  v_seat := public.online_member_seat(p_room_id);
  update public.online_room_players p set last_seen = now()
  where p.room_id = p_room_id and p.user_id = auth.uid();
  perform public.online_finish_round(
    p_room_id, (3 - v_seat)::smallint, 'forfeit',
    format('Le joueur %s a abandonné la manche.', v_seat), null
  );
end;
$$;

revoke all on function public.forfeit_online_round(uuid) from public, anon;
grant execute on function public.forfeit_online_round(uuid) to authenticated;

create or replace function public.forfeit_online_series(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_seat smallint;
  v_game public.online_games%rowtype;
  v_room public.online_rooms%rowtype;
  v_scores smallint[];
  v_colors jsonb;
  v_target integer;
begin
  v_seat := public.online_member_seat(p_room_id);
  select * into v_game from public.online_games g where g.room_id = p_room_id for update;
  if v_game.phase = 'match_finished' then return; end if;
  select * into v_room from public.online_rooms r where r.id = p_room_id;
  v_target := (v_room.series_length / 2) + 1;
  v_scores := v_game.scores;
  v_scores[3 - v_seat] := v_target;
  select jsonb_object_agg(s.seat::text, s.color order by s.seat) into v_colors
  from public.online_player_secrets s
  where s.room_id = p_room_id and s.round_number = v_game.round_number;

  update public.online_games g set
    phase = 'match_finished', current_seat = null, scores = v_scores,
    round_result = 'series_forfeit', round_winner = (3 - v_seat)::smallint,
    round_reason = format('Le joueur %s a abandonné le BO.', v_seat),
    revealed_colors = v_colors, next_ready_seats = '{}'::smallint[],
    next_countdown_started_at = null, version = g.version + 1
  where g.room_id = p_room_id;
  update public.online_rooms r set status = 'finished' where r.id = p_room_id;
end;
$$;

revoke all on function public.forfeit_online_series(uuid) from public, anon;
grant execute on function public.forfeit_online_series(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'online_games'
  ) then
    alter publication supabase_realtime add table public.online_games;
  end if;
end;
$$;
