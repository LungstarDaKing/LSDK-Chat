-- LSDKChat v0.16: WATCH TOGETHER with ANY web link (the app inspects every link before opening it; see src/lib/linkscan.js).
-- Run in Supabase > SQL Editor AFTER update-v0.13.sql. Safe to run twice.
-- This only allows a new kind of shared item ('web', an https address). It does not make a link safe: the apps check it on both devices.

alter table public.watch_sessions drop constraint if exists watch_sessions_provider_check;
alter table public.watch_sessions add constraint watch_sessions_provider_check check (provider in ('youtube','spotify','apple','tiktok','web'));
alter table public.watch_sessions drop constraint if exists watch_sessions_media_id_check;
alter table public.watch_sessions add constraint watch_sessions_media_id_check check (char_length(media_id) <= 400);

create or replace function public.watch_valid(p_provider text, p_media text) returns boolean language sql immutable set search_path = '' as $$
  select case p_provider
    when 'youtube' then p_media ~ '^[A-Za-z0-9_-]{11}$'
    when 'spotify' then p_media ~ '^(track|album|playlist|episode|show|artist)/[A-Za-z0-9]{10,30}$'
    when 'apple'   then p_media ~ '^/[a-z]{2}/(album|playlist|song|artist|music-video|station)/[A-Za-z0-9_~%-]{1,100}(/[A-Za-z0-9_~%-]{1,60}){0,2}(\?i=[0-9]{5,15})?$'
    when 'tiktok'  then p_media ~ '^[0-9]{5,25}$'
    -- a basic shape check only: https, no spaces or quote/angle characters, no "user@" part. The real inspection happens in the apps.
    when 'web'     then p_media ~ '^https://[A-Za-z0-9.-]{3,253}(/[^[:space:]<>"''`\\]*)?$' and char_length(p_media) <= 400
    else false end
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
      case p_provider when 'youtube' then 'YouTube' when 'spotify' then 'Spotify' when 'apple' then 'Apple Music' when 'web' then 'a web link' else 'TikTok' end || ')');
  exception when others then null; end;
end;
$$;
