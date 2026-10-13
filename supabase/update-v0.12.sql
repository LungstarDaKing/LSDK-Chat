-- LSDKChat v0.12: adds DARTS to the two-player games. Run in Supabase > SQL Editor AFTER update-v0.11.sql. Safe to run twice.
alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check check (kind in ('ttt','chess','hangman','twenty','darts'));

create or replace function public.game_title(k text) returns text language sql immutable set search_path = '' as $$
  select case k when 'ttt' then 'Tic-tac-toe' when 'chess' then 'Chess' when 'hangman' then 'Hangman' when 'darts' then 'Darts' else '20 Questions' end
$$;

-- ---------- start ----------
create or replace function public.game_start(p_room uuid, p_kind text, p_secret text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid(); other uuid; gid uuid; st jsonb; t uuid; sec text := btrim(coalesce(p_secret, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('ttt','chess','hangman','twenty','darts') then raise exception 'Unknown game'; end if;
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

  if p_kind = 'darts' then st := jsonb_build_object('s1', 301, 's2', 301, 'turns', jsonb_build_array()); t := me;
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

