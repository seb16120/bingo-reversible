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
