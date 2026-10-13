-- LSDKChat v0.10: two-player games inside a direct chat.
-- Run in Supabase > SQL Editor AFTER update-v0.9.sql (and the group-calls SQL). Safe to run twice.
--
-- Games: tic-tac-toe, chess, 20 questions, hangman. Solo games (stickman, emoji song, word
-- puzzles) need no database at all.
-- Move legality for tic-tac-toe / chess is checked in the app (friendly games); the database
-- checks who is allowed to move, the order of moves (version), size limits, and keeps
-- the hangman / 20-questions secret hidden from the guesser until the game ends.

create table if not exists public.games (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  kind       text not null check (kind in ('ttt','chess','hangman','twenty')),
  p1         uuid not null references public.profiles(id) on delete cascade,   -- who started it
  p2         uuid not null references public.profiles(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,
  turn       uuid,
  status     text not null default 'active' check (status in ('active','done')),
  winner     uuid,
  result     text check (result is null or char_length(result) <= 80),
  version    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_two_players check (p1 <> p2)
);
create unique index if not exists games_one_active_per_room on public.games (room_id) where status = 'active';
create index if not exists games_room_idx on public.games (room_id, created_at desc);

-- the secret word / thing: nobody can read it through the API; game_secret() reveals it at the right time
create table if not exists public.game_secrets (
  game_id uuid primary key references public.games(id) on delete cascade,
  secret  text not null check (char_length(secret) between 1 and 40)
);

alter table public.games enable row level security;
alter table public.game_secrets enable row level security;
revoke all on public.games, public.game_secrets from anon, authenticated;
grant select on public.games to authenticated;
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated using (auth.uid() in (p1, p2));

-- ---------- helpers ----------
create or replace function public.game_title(k text) returns text language sql immutable set search_path = '' as $$
  select case k when 'ttt' then 'Tic-tac-toe' when 'chess' then 'Chess' when 'hangman' then 'Hangman' else '20 Questions' end
$$;

-- ---------- start ----------
create or replace function public.game_start(p_room uuid, p_kind text, p_secret text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); other uuid; gid uuid; st jsonb; t uuid; sec text := btrim(coalesce(p_secret, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('ttt','chess','hangman','twenty') then raise exception 'Unknown game'; end if;
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

  if p_kind = 'ttt' then st := jsonb_build_object('board', jsonb_build_array(null,null,null,null,null,null,null,null,null)); t := me;
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

-- ---------- a move (tic-tac-toe, chess, 20 questions) ----------
-- The app works out the new state; the database checks it is your turn, the move order, and the size.
create or replace function public.game_move(p_game uuid, p_version integer, p_state jsonb, p_status text default 'active', p_winner uuid default null, p_result text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); g public.games%rowtype;
begin
  select * into g from public.games where id = p_game for update;
  if not found or me is null or me not in (g.p1, g.p2) then raise exception 'Game not found'; end if;
  if g.status <> 'active' then raise exception 'This game is over'; end if;
  if g.kind = 'hangman' then raise exception 'Use game_guess for hangman'; end if;
  if g.turn is distinct from me then raise exception 'It is not your turn'; end if;
  if g.version <> p_version then raise exception 'The game changed. Refresh and try again.'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 20000 then raise exception 'Invalid move'; end if;
  if p_status not in ('active','done') then raise exception 'Invalid move'; end if;
  if p_winner is not null and p_winner not in (g.p1, g.p2) then raise exception 'Invalid move'; end if;
  if g.kind = 'twenty' and p_status = 'done' and g.state ->> 'asked' is null then raise exception 'Invalid move'; end if;
  update public.games set state = p_state, status = p_status, winner = case when p_status = 'done' then p_winner end,
    result = case when p_status = 'done' then left(p_result, 80) end,
    turn = case when p_status = 'done' then null when me = p1 then p2 else p1 end,
    version = version + 1, updated_at = now()
  where id = p_game;
end;
$$;

-- ---------- hangman: the guesser picks a letter, the database knows the word ----------
create or replace function public.game_guess(p_game uuid, p_letter text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); g public.games%rowtype; sec text; l text := upper(btrim(coalesce(p_letter, '')));
  wrong jsonb; rightl jsonb; mask text := ''; i int; ch text; done boolean := false; win uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found or me is null or me not in (g.p1, g.p2) then raise exception 'Game not found'; end if;
  if g.kind <> 'hangman' or g.status <> 'active' then raise exception 'This game is over'; end if;
  if g.turn is distinct from me then raise exception 'It is not your turn'; end if;
  if l !~ '^[A-Z]$' then raise exception 'Pick one letter'; end if;
  select secret into sec from public.game_secrets where game_id = p_game;
  wrong := g.state -> 'wrong'; rightl := g.state -> 'right';
  if wrong ? l or rightl ? l then raise exception 'You already tried that letter'; end if;
  if position(l in sec) > 0 then rightl := rightl || to_jsonb(l); else wrong := wrong || to_jsonb(l); end if;
  for i in 1..char_length(sec) loop
    ch := substr(sec, i, 1); mask := mask || case when rightl ? ch then ch else '_' end;
  end loop;
  if mask = sec then done := true; win := me;
  elsif jsonb_array_length(wrong) >= (g.state ->> 'max')::int then done := true; win := case when me = g.p1 then g.p2 else g.p1 end; end if;
  update public.games set
    state = g.state || jsonb_build_object('mask', mask, 'wrong', wrong, 'right', rightl) || case when done then jsonb_build_object('word', sec) else '{}'::jsonb end,
    status = case when done then 'done' else 'active' end, winner = win,
    result = case when done then case when win = me then 'Word guessed' else 'Out of tries' end end,
    turn = case when done then null else me end, version = version + 1, updated_at = now()
  where id = p_game;
end;
$$;

-- ---------- reveal the secret: to the person who set it any time, to both once the game is over ----------
create or replace function public.game_secret(p_game uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); g public.games%rowtype; s text;
begin
  select * into g from public.games where id = p_game;
  if not found or me not in (g.p1, g.p2) then raise exception 'Game not found'; end if;
  if g.status = 'active' and me <> g.p1 then return null; end if;
  select secret into s from public.game_secrets where game_id = p_game;
  return s;
end;
$$;

-- ---------- give up / end ----------
create or replace function public.game_resign(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); g public.games%rowtype;
begin
  select * into g from public.games where id = p_game for update;
  if not found or me is null or me not in (g.p1, g.p2) then raise exception 'Game not found'; end if;
  if g.status <> 'active' then return; end if;
  update public.games set status = 'done', turn = null, winner = case when me = p1 then p2 else p1 end, result = 'Gave up',
    state = case when kind in ('hangman') then state || jsonb_build_object('word', (select secret from public.game_secrets where game_id = p_game)) else state end,
    version = version + 1, updated_at = now() where id = p_game;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['game_start(uuid,text,text)','game_move(uuid,integer,jsonb,text,uuid,text)','game_guess(uuid,text)','game_secret(uuid)','game_resign(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  begin alter publication supabase_realtime add table public.games; exception when duplicate_object then null; end;
end $$;
