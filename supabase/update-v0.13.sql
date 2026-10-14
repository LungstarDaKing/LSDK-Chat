-- LSDKChat v0.13: WATCH TOGETHER in a direct chat (YouTube synced; Spotify, Apple Music and TikTok shared with a 3-2-1 countdown).
-- Run in Supabase > SQL Editor AFTER update-v0.12.sql. Safe to run twice.

create table if not exists public.watch_sessions (
  room_id     uuid primary key references public.rooms(id) on delete cascade,
  provider    text not null check (provider in ('youtube','spotify','apple','tiktok')),
  media_id    text not null check (char_length(media_id) <= 200),
  host        uuid not null references public.profiles(id) on delete cascade,
  controllers uuid[] not null default '{}',
  requests    uuid[] not null default '{}',
  playing     boolean not null default false,
  pos         real not null default 0 check (pos >= 0),
  cd          integer not null default 0,          -- "3-2-1 play together" counter (Spotify / Apple Music / TikTok)
  version     integer not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.watch_sessions enable row level security;
revoke all on public.watch_sessions from anon, authenticated;
grant select on public.watch_sessions to authenticated;
drop policy if exists watch_select on public.watch_sessions;
create policy watch_select on public.watch_sessions for select to authenticated
  using (exists (select 1 from public.participants p where p.room_id = watch_sessions.room_id and p.profile_id = auth.uid()));

create or replace function public.watch_valid(p_provider text, p_media text) returns boolean language sql immutable set search_path = '' as $$
  select case p_provider
    when 'youtube' then p_media ~ '^[A-Za-z0-9_-]{11}$'
    when 'spotify' then p_media ~ '^(track|album|playlist|episode|show|artist)/[A-Za-z0-9]{10,30}$'
    when 'apple'   then p_media ~ '^/[a-z]{2}/(album|playlist|song|artist|music-video|station)/[A-Za-z0-9_~%-]{1,100}(/[A-Za-z0-9_~%-]{1,60}){0,2}(\?i=[0-9]{5,15})?$'
    when 'tiktok'  then p_media ~ '^[0-9]{5,25}$'
    else false end
$$;

create or replace function public.watch_member(p_room uuid) returns uuid language plpgsql stable security definer set search_path = '' as $$
declare me uuid := auth.uid(); other uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and r.is_direct and r.notes_owner is null) then raise exception 'Watching together works in a chat between two people'; end if;
  if not exists (select 1 from public.participants where room_id = p_room and profile_id = me) then raise exception 'Not your chat'; end if;
  select profile_id into other from public.participants where room_id = p_room and profile_id <> me limit 1;
  if other is null then raise exception 'Watching together works in a chat between two people'; end if;
  return other;
end;
$$;

create or replace function public.watch_start(p_room uuid, p_provider text, p_media text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); other uuid := public.watch_member(p_room);
begin
  if not public.watch_valid(p_provider, p_media) then raise exception 'That link is not supported'; end if;
  if (select count(*) from public.watch_sessions where host = me and updated_at > now() - interval '1 minute') >= 6 then raise exception 'Slow down a little'; end if;
  insert into public.watch_sessions (room_id, provider, media_id, host, controllers, requests, playing, pos, cd, version, updated_at)
  values (p_room, p_provider, p_media, me, array[me], '{}', false, 0, 0, 0, now())
  on conflict (room_id) do update set provider = excluded.provider, media_id = excluded.media_id, host = excluded.host, controllers = excluded.controllers,
    requests = '{}', playing = false, pos = 0, cd = 0, version = public.watch_sessions.version + 1, updated_at = now();
  begin
    insert into public.messages (room_id, sender_id, content) values (p_room, me, 'Started watching together (' ||
      case p_provider when 'youtube' then 'YouTube' when 'spotify' then 'Spotify' when 'apple' then 'Apple Music' else 'TikTok' end || ')');
  exception when others then null; end;
end;
$$;

-- play / pause / seek / countdown: only people allowed to control
create or replace function public.watch_control(p_room uuid, p_action text, p_pos real default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); w public.watch_sessions%rowtype;
begin
  perform public.watch_member(p_room);
  select * into w from public.watch_sessions where room_id = p_room for update;
  if not found then raise exception 'Nothing is being watched'; end if;
  if not (me = any(w.controllers)) then raise exception 'Ask for control first'; end if;
  if p_action not in ('play','pause','seek','countdown') then raise exception 'Unknown action'; end if;
  if p_pos is null or p_pos < 0 or p_pos > 100000 then raise exception 'Invalid position'; end if;
  update public.watch_sessions set
    playing = case p_action when 'play' then true when 'pause' then false else playing end,
    pos = case when p_action = 'countdown' then pos else p_pos end,
    cd = case when p_action = 'countdown' then cd + 1 else cd end,
    version = version + 1, updated_at = now()
  where room_id = p_room;
end;
$$;

create or replace function public.watch_request(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  perform public.watch_member(p_room);
  update public.watch_sessions set requests = case when me = any(controllers) or me = any(requests) then requests else requests || me end,
    version = version + 1, updated_at = now() where room_id = p_room;
end;
$$;

-- the person who started it says yes or no to a request, or takes control back
create or replace function public.watch_grant(p_room uuid, p_user uuid, p_allow boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); w public.watch_sessions%rowtype;
begin
  perform public.watch_member(p_room);
  select * into w from public.watch_sessions where room_id = p_room for update;
  if not found then raise exception 'Nothing is being watched'; end if;
  if w.host <> me then raise exception 'Only the person who started it can do this'; end if;
  if p_user = me then raise exception 'You always control your own session'; end if;
  update public.watch_sessions set
    controllers = case when p_allow then (select array_agg(distinct x) from unnest(controllers || p_user) x) else array_remove(controllers, p_user) end,
    requests = array_remove(requests, p_user), version = version + 1, updated_at = now()
  where room_id = p_room;
end;
$$;

create or replace function public.watch_stop(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.watch_member(p_room);
  delete from public.watch_sessions where room_id = p_room;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['watch_member(uuid)','watch_start(uuid,text,text)','watch_control(uuid,text,real)','watch_request(uuid)','watch_grant(uuid,uuid,boolean)','watch_stop(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  begin alter publication supabase_realtime add table public.watch_sessions; exception when duplicate_object then null; end;
end $$;
