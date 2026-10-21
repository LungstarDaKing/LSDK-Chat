-- LSDKChat v0.15: adds the CAR RACE to the two-player games. Run in Supabase > SQL Editor AFTER update-v0.12.sql. Safe to run twice.
-- The race itself runs live between the two phones/computers (Supabase Realtime broadcast, nothing is stored while driving).
-- The database only keeps the lobby (car, colour, map, ready) and the result.

alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check check (kind in ('ttt','chess','hangman','twenty','darts','race'));

create or replace function public.game_title(k text) returns text language sql immutable set search_path = '' as $$
  select case k when 'ttt' then 'Tic-tac-toe' when 'chess' then 'Chess' when 'hangman' then 'Hangman' when 'darts' then 'Darts' when 'race' then 'Car race' else '20 Questions' end
$$;

create or replace function public.game_start(p_room uuid, p_kind text, p_secret text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); other uuid; gid uuid; st jsonb; t uuid; sec text := btrim(coalesce(p_secret, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('ttt','chess','hangman','twenty','darts','race') then raise exception 'Unknown game'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and r.is_direct and not coalesce(r.notes_owner is not null, false)) then
    raise exception 'Games can be played in a chat between two people';
  end if;
  select profile_id into other from public.participants where room_id = p_room and profile_id <> me limit 1;
  if other is null or not exists (select 1 from public.participants where room_id = p_room and profile_id = me) then
    raise exception 'Games can be played in a chat between two people';
  end if;
  if exists (select 1 from public.games where room_id = p_room and status = 'active') then
    raise exception 'A game is already going on in this chat. Finish it or give up first.';
  end if;
  if (select count(*) from public.games where room_id = p_room and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many games started. Wait a little.';
  end if;

  if p_kind = 'race' then st := jsonb_build_object('map', 'kyalami', 'laps', 3, 'balanced', false, 'round', 0, 'cars', jsonb_build_object(), 'ready', jsonb_build_object(), 'times', jsonb_build_object()); t := null;   -- a race has no turns
  elsif p_kind = 'darts' then st := jsonb_build_object('s1', 301, 's2', 301, 'turns', jsonb_build_array()); t := me;
  elsif p_kind = 'ttt' then st := jsonb_build_object('board', jsonb_build_array(null,null,null,null,null,null,null,null,null)); t := me;
  elsif p_kind = 'chess' then st := jsonb_build_object('fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'moves', jsonb_build_array()); t := me;   -- starter plays white
  elsif p_kind = 'hangman' then
    sec := upper(sec);
    if sec !~ '^[A-Z]{3,20}$' then raise exception 'Use 3 to 20 letters, A to Z only'; end if;
    st := jsonb_build_object('mask', (select string_agg('_', '') from generate_series(1, char_length(sec))), 'wrong', jsonb_build_array(), 'right', jsonb_build_array(), 'max', 7, 'len', char_length(sec));
    t := other;            -- the starter chooses the word, the other person guesses
  else
    if char_length(sec) not between 2 and 40 then raise exception 'Think of something (2 to 40 characters)'; end if;
    st := jsonb_build_object('log', jsonb_build_array(), 'asked', 0);
    t := other;            -- the starter thinks of it, the other person asks
  end if;

  insert into public.games (room_id, kind, p1, p2, state, turn) values (p_room, p_kind, me, other, st, t) returning id into gid;
  if p_kind in ('hangman','twenty') then insert into public.game_secrets (game_id, secret) values (gid, sec); end if;
  begin
    insert into public.messages (room_id, sender_id, content) values (p_room, me, 'Started a game: ' || public.game_title(p_kind));
  exception when others then null; end;
  return gid;
end;
$$;

-- ---------- lobby: pick a car, colour, map, laps; say you are ready ----------
create or replace function public.race_setup(p_game uuid, p_car text default null, p_color text default null, p_map text default null,
  p_laps integer default null, p_balanced boolean default null, p_ready boolean default null, p_start boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); g public.games%rowtype; st jsonb; mine jsonb; host_change boolean := false;
begin
  select * into g from public.games where id = p_game for update;
  if not found or me is null or me not in (g.p1, g.p2) or g.kind <> 'race' then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'This game is over'; end if;
  st := g.state;
  if p_car is not null or p_color is not null then
    if p_car is not null and p_car !~ '^[a-z0-9_]{1,24}$' then raise exception 'Invalid car'; end if;
    if p_color is not null and p_color !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Invalid colour'; end if;
    mine := coalesce(st -> 'cars' -> me::text, '{}'::jsonb);
    if p_car is not null then mine := mine || jsonb_build_object('car', p_car); end if;
    if p_color is not null then mine := mine || jsonb_build_object('color', p_color); end if;
    st := jsonb_set(st, array['cars', me::text], mine, true);
  end if;
  if me = g.p1 then                                                          -- the host decides the map and the rules
    if p_map is not null then if p_map !~ '^[a-z0-9_]{1,24}$' then raise exception 'Invalid map'; end if; st := st || jsonb_build_object('map', p_map); host_change := true; end if;
    if p_laps is not null then if p_laps not between 1 and 10 then raise exception 'Invalid laps'; end if; st := st || jsonb_build_object('laps', p_laps); host_change := true; end if;
    if p_balanced is not null then st := st || jsonb_build_object('balanced', p_balanced); host_change := true; end if;
  end if;
  if host_change then st := jsonb_set(st, '{ready}', '{}'::jsonb); end if;               -- rules changed: everybody must say ready again
  if p_ready is not null then st := jsonb_set(st, array['ready', me::text], to_jsonb(p_ready), true); end if;
  if p_start and me = g.p1 then                                              -- the host starts the race: clear "ready" so a reload cannot restart it
    st := jsonb_set(st, '{ready}', '{}'::jsonb); st := jsonb_set(st, '{round}', to_jsonb(coalesce((st ->> 'round')::int, 0) + 1));
  end if;
  if octet_length(st::text) > 4000 then raise exception 'Invalid setup'; end if;
  update public.games set state = st, version = version + 1, updated_at = now() where id = p_game;
end;
$$;

-- ---------- finish: either player can report the result (friendly game: the app decides who crossed the line first) ----------
create or replace function public.race_finish(p_game uuid, p_winner uuid, p_times jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); g public.games%rowtype;
begin
  select * into g from public.games where id = p_game for update;
  if not found or me is null or me not in (g.p1, g.p2) or g.kind <> 'race' then raise exception 'Game not found'; end if;
  if g.status <> 'active' then return; end if;                               -- already finished by the other player
  if p_winner is null or p_winner not in (g.p1, g.p2) then raise exception 'Invalid result'; end if;
  if p_times is null or jsonb_typeof(p_times) <> 'object' or octet_length(p_times::text) > 600 then p_times := '{}'::jsonb; end if;
  update public.games set status = 'done', turn = null, winner = p_winner, result = 'Won the race',
    state = state || jsonb_build_object('times', p_times), version = version + 1, updated_at = now() where id = p_game;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['game_start(uuid,text,text)','race_setup(uuid,text,text,text,integer,boolean,boolean,boolean)','race_finish(uuid,uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
