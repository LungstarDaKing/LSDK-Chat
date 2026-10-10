-- =====================================================================
-- LSDKChat update v0.4: status updates (stories), "Seen" receipts, typing,
-- voice notes, free voice/video calls, unread counts.
--
-- Run ONCE in Supabase -> SQL Editor, AFTER update-v0.3.sql.
-- NON-destructive and safe to run again.
--
-- Privacy design
--   * Stories: visible only to people who share a chat with you, and only while
--     you leave "share my status" on.  Expire after 24 h.
--   * Seen receipts: reciprocal (turn yours off and you cannot see others').
--   * Calls: allowed only between people who have each sent at least one message
--     in their direct chat.  The call log is kept 90 days.
--   * Everything is enforced here in the database, not in the browser.
-- =====================================================================

-- ---------- settings ----------
alter table public.user_private add column if not exists share_stories boolean not null default true;
alter table public.user_private add column if not exists read_receipts boolean not null default true;

create or replace function public.set_story_sharing(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_on is null then raise exception 'Invalid setting'; end if;
  update public.user_private set share_stories = p_on where id = auth.uid();
end;
$$;
create or replace function public.set_read_receipts(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_on is null then raise exception 'Invalid setting'; end if;
  update public.user_private set read_receipts = p_on where id = auth.uid();
end;
$$;

-- ---------- voice notes ----------
alter table public.messages add column if not exists attachment_duration integer;   -- milliseconds
alter table public.messages drop constraint if exists messages_duration_check;
alter table public.messages add constraint messages_duration_check
  check (attachment_duration is null
         or (attachment_path is not null and attachment_type like 'audio/%' and attachment_duration between 300 and 600000));

-- ---------- read receipts + unread counts ----------
create table if not exists public.room_reads (
  room_id      uuid not null references public.rooms(id)    on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);
alter table public.room_reads enable row level security;
revoke all on public.room_reads from anon, authenticated;       -- only reachable through the functions below

create or replace function public.mark_room_read(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_member(p_room) then raise exception 'You are not in this room'; end if;
  insert into public.room_reads (room_id, profile_id, last_read_at) values (p_room, auth.uid(), now())
  on conflict (room_id, profile_id) do update set last_read_at = greatest(public.room_reads.last_read_at, excluded.last_read_at);
end;
$$;

-- Others' "seen" times, only if BOTH sides have receipts switched on.
create or replace function public.get_room_reads(p_room uuid)
returns table (profile_id uuid, last_read_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_room_member(p_room) then raise exception 'You are not in this room'; end if;
  if not coalesce((select u.read_receipts from public.user_private u where u.id = auth.uid()), false) then return; end if;
  return query
    select r.profile_id, r.last_read_at
    from public.room_reads r
    join public.user_private u on u.id = r.profile_id and u.read_receipts
    where r.room_id = p_room and r.profile_id <> auth.uid();
end;
$$;

create or replace function public.get_unread_counts()
returns table (room_id uuid, unread integer)
language sql stable security definer set search_path = '' as $$
  select p.room_id,
         (select count(*)::int from public.messages m
          where m.room_id = p.room_id and m.sender_id <> auth.uid()
            and m.created_at > coalesce(rr.last_read_at, p.joined_at))
  from public.participants p
  left join public.room_reads rr on rr.room_id = p.room_id and rr.profile_id = p.profile_id
  where p.profile_id = auth.uid();
$$;

-- ---------- private realtime channel for typing / read pings ----------
create or replace function public.rt_room_ok(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_room_member(substr(p_topic, 6)::uuid) else false end;
$$;
revoke all on function public.rt_room_ok(text) from public, anon;
grant execute on function public.rt_room_ok(text) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists lsdk_room_events_read on realtime.messages';
    execute 'drop policy if exists lsdk_room_events_write on realtime.messages';
    execute $p$create policy lsdk_room_events_read on realtime.messages for select to authenticated
               using (extension = 'broadcast' and public.rt_room_ok(realtime.topic()))$p$;
    execute $p$create policy lsdk_room_events_write on realtime.messages for insert to authenticated
               with check (extension = 'broadcast' and public.rt_room_ok(realtime.topic()))$p$;
  end if;
exception when others then
  raise notice 'Could not create realtime policies (%). Typing indicators may not work; everything else is fine.', sqlerrm;
end $$;

-- =====================================================================
-- STORIES (status updates)
-- =====================================================================
create table if not exists public.stories (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid not null references public.profiles(id) on delete cascade,
  kind             text not null check (kind in ('text','image','video','audio')),
  content          text not null default '' check (char_length(content) <= 300),
  bg               smallint check (bg between 0 and 7),
  attachment_path  text,
  attachment_name  text,
  attachment_type  text,
  attachment_size  integer,
  reported         boolean not null default false,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  constraint story_shape check (
    (kind = 'text' and char_length(btrim(content)) >= 1 and bg is not null
       and attachment_path is null and attachment_name is null and attachment_type is null and attachment_size is null)
    or
    (kind <> 'text' and bg is null
       and attachment_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$'
       and split_part(attachment_path, '/', 1) = author_id::text
       and attachment_type in ('image/jpeg','image/png','image/gif','image/webp',
                               'video/mp4','video/webm','video/quicktime',
                               'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac')
       and split_part(attachment_type, '/', 1) = kind
       and attachment_size between 1 and 20971520
       and char_length(attachment_name) between 1 and 120)
  )
);
create index if not exists stories_author_idx  on public.stories (author_id, created_at desc);
create index if not exists stories_expires_idx on public.stories (expires_at);

create table if not exists public.story_views (
  story_id  uuid not null references public.stories(id)  on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.stories      enable row level security;
alter table public.story_views  enable row level security;
revoke all on public.stories, public.story_views from anon, authenticated;
grant select on public.stories to authenticated;
grant insert (author_id, kind, content, bg, attachment_path, attachment_name, attachment_type, attachment_size)
  on public.stories to authenticated;
grant delete on public.stories to authenticated;
grant select on public.story_views to authenticated;

-- may I see this person's stories?  (me, or: they share + they share a chat with me)
create or replace function public.story_visible(p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_author = auth.uid() or (
    coalesce((select u.share_stories from public.user_private u where u.id = p_author), false)
    and exists (select 1 from public.participants a
                join public.participants b on b.room_id = a.room_id
                where a.profile_id = auth.uid() and b.profile_id = p_author));
$$;

drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories for select to authenticated
  using (author_id = auth.uid() or (expires_at > now() and public.story_visible(author_id)));
drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories for delete to authenticated
  using (author_id = auth.uid() and not reported);          -- reported stories are kept until the operator reviews them

drop policy if exists story_views_select on public.story_views;
create policy story_views_select on public.story_views for select to authenticated
  using (viewer_id = auth.uid());

create or replace function public.stories_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.stories where author_id = new.author_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'You can post at most 20 status updates per day.' using errcode = 'P0001';
  end if;
  if new.attachment_path is not null and not exists (
       select 1 from storage.objects where bucket_id = 'stories' and name = new.attachment_path) then
    raise exception 'Upload not found. Please try again.';
  end if;
  return new;
end;
$$;
drop trigger if exists stories_before_insert on public.stories;
create trigger stories_before_insert before insert on public.stories
  for each row execute function public.stories_before_insert();
revoke all on function public.stories_before_insert() from public, anon, authenticated;

create or replace function public.mark_story_viewed(p_story uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.stories%rowtype;
begin
  select * into s from public.stories where id = p_story;
  if not found or s.expires_at <= now() or not public.story_visible(s.author_id) then raise exception 'Status not found'; end if;
  if s.author_id = auth.uid() then return; end if;
  insert into public.story_views (story_id, viewer_id) values (p_story, auth.uid()) on conflict do nothing;
end;
$$;

create or replace function public.get_story_viewers(p_story uuid)
returns table (viewer_id uuid, username text, viewed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stories where id = p_story and author_id = auth.uid()) then
    raise exception 'Status not found';
  end if;
  return query select v.viewer_id, p.username, v.viewed_at
               from public.story_views v join public.profiles p on p.id = v.viewer_id
               where v.story_id = p_story order by v.viewed_at desc;
end;
$$;

alter table public.reports add column if not exists story_id uuid references public.stories(id) on delete set null;
create or replace function public.report_story(p_story uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.stories%rowtype;
begin
  select * into s from public.stories where id = p_story;
  if not found or s.expires_at <= now() or not public.story_visible(s.author_id) then raise exception 'Status not found'; end if;
  if s.author_id = auth.uid() then raise exception 'You cannot report your own status'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'Please describe the problem (max 500 characters)'; end if;
  insert into public.reports (reporter_id, reported_user_id, message_snapshot, reason, story_id, attachment_path)
  values (auth.uid(), s.author_id,
          '[status ' || s.kind || '] ' || s.content || case when s.attachment_path is not null then ' [file: ' || s.attachment_name || ']' else '' end,
          btrim(p_reason), s.id, case when s.attachment_path is not null then 'stories/' || s.attachment_path end);
  update public.stories set reported = true where id = s.id;
end;
$$;

-- ---------- stories storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('stories', 'stories', false, 20971520, array[
     'image/jpeg','image/png','image/gif','image/webp','video/mp4','video/webm','video/quicktime',
     'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_story_read_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 1) = auth.uid()::text
      or exists (select 1 from public.stories s
                 where s.attachment_path = p_name and s.expires_at > now() and public.story_visible(s.author_id));
$$;
create or replace function public.storage_story_delete_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select split_part(p_name, '/', 1) = auth.uid()::text
     and not exists (select 1 from public.stories s where s.attachment_path = p_name and s.reported);
$$;
create or replace function public.storage_story_quota_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects where bucket_id = 'stories' and split_part(name, '/', 1) = auth.uid()::text) < 30;
$$;

drop policy if exists lsdk_stories_read   on storage.objects;
drop policy if exists lsdk_stories_insert on storage.objects;
drop policy if exists lsdk_stories_delete on storage.objects;
create policy lsdk_stories_read on storage.objects for select to authenticated
  using (bucket_id = 'stories' and public.storage_story_read_ok(name));
create policy lsdk_stories_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stories' and split_part(name, '/', 1) = auth.uid()::text
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$' and public.storage_story_quota_ok());
create policy lsdk_stories_delete on storage.objects for delete to authenticated
  using (bucket_id = 'stories' and public.storage_story_delete_ok(name));

-- =====================================================================
-- CALLS (voice / video, peer to peer)
-- =====================================================================
create table if not exists public.calls (
  id            uuid primary key default gen_random_uuid(),
  caller_id     uuid not null references public.profiles(id) on delete cascade,
  callee_id     uuid not null references public.profiles(id) on delete cascade,
  room_id       uuid references public.rooms(id) on delete set null,
  kind          text not null check (kind in ('voice','video')),
  status        text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended','busy')),
  created_at    timestamptz not null default now(),
  answered_at   timestamptz,
  ended_at      timestamptz,
  caller_hidden boolean not null default false,
  callee_hidden boolean not null default false,
  check (caller_id <> callee_id)
);
create index if not exists calls_caller_idx on public.calls (caller_id, created_at desc);
create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);

create table if not exists public.call_signals (
  id         uuid primary key default gen_random_uuid(),
  call_id    uuid not null references public.calls(id) on delete cascade,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('offer','answer','candidate')),
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_call_idx on public.call_signals (call_id);

alter table public.calls        enable row level security;
alter table public.call_signals enable row level security;
revoke all on public.calls, public.call_signals from anon, authenticated;
grant select on public.calls, public.call_signals to authenticated;

drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls for select to authenticated
  using ((caller_id = auth.uid() and not caller_hidden) or (callee_id = auth.uid() and not callee_hidden));
drop policy if exists call_signals_select on public.call_signals;
create policy call_signals_select on public.call_signals for select to authenticated
  using (to_id = auth.uid());

create or replace function public.start_call(p_callee uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rid uuid;
  cid uuid;
  busy boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('voice','video') then raise exception 'Invalid call type'; end if;
  if p_callee is null or p_callee = me then raise exception 'Choose someone else to call'; end if;

  select r.id into rid
  from public.rooms r
  join public.participants a on a.room_id = r.id and a.profile_id = me
  join public.participants b on b.room_id = r.id and b.profile_id = p_callee
  where r.is_direct limit 1;
  if rid is null
     or not exists (select 1 from public.messages where room_id = rid and sender_id = me)
     or not exists (select 1 from public.messages where room_id = rid and sender_id = p_callee) then
    raise exception 'You can call someone once you have both sent each other a message.';
  end if;

  delete from public.calls where created_at < now() - interval '90 days';
  update public.calls set status = 'missed', ended_at = now()
   where caller_id = me and status = 'ringing' and created_at < now() - interval '60 seconds';

  if (select count(*) from public.calls where caller_id = me and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many calls. Please wait a few minutes.';
  end if;
  if exists (select 1 from public.calls
             where (caller_id = me or callee_id = me)
               and ((status = 'ringing' and created_at > now() - interval '60 seconds')
                 or (status = 'accepted' and ended_at is null and created_at > now() - interval '4 hours'))) then
    raise exception 'You are already in a call.';
  end if;

  select exists (select 1 from public.calls
                 where (caller_id = p_callee or callee_id = p_callee)
                   and ((status = 'ringing' and created_at > now() - interval '60 seconds')
                     or (status = 'accepted' and ended_at is null and created_at > now() - interval '4 hours'))) into busy;

  insert into public.calls (caller_id, callee_id, room_id, kind, status, ended_at)
  values (me, p_callee, rid, p_kind, case when busy then 'busy' else 'ringing' end, case when busy then now() end)
  returning id into cid;
  return cid;
end;
$$;

create or replace function public.answer_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.calls set status = 'accepted', answered_at = now()
   where id = p_call and callee_id = auth.uid() and status = 'ringing' and created_at > now() - interval '60 seconds';
  if not found then raise exception 'This call is no longer available.'; end if;
end;
$$;

create or replace function public.decline_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.calls set status = 'declined', ended_at = now()
   where id = p_call and callee_id = auth.uid() and status = 'ringing';
  delete from public.call_signals where call_id = p_call;
end;
$$;

create or replace function public.end_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.calls%rowtype;
begin
  select * into c from public.calls where id = p_call and (caller_id = auth.uid() or callee_id = auth.uid());
  if not found then return; end if;
  if c.status = 'ringing' then
    update public.calls set status = case when c.caller_id = auth.uid() then 'missed' else 'declined' end, ended_at = now() where id = p_call;
  elsif c.status = 'accepted' then
    update public.calls set status = 'ended', ended_at = now() where id = p_call;
  end if;
  delete from public.call_signals where call_id = p_call;
end;
$$;

create or replace function public.send_call_signal(p_call uuid, p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.calls%rowtype;
  me uuid := auth.uid();
begin
  select * into c from public.calls where id = p_call and (caller_id = me or callee_id = me);
  if not found or c.status not in ('ringing','accepted') then raise exception 'Call not active'; end if;
  if p_kind not in ('offer','answer','candidate') then raise exception 'Invalid signal'; end if;
  if p_payload is null or octet_length(p_payload::text) > 20000 then raise exception 'Signal too large'; end if;
  if (select count(*) from public.call_signals where call_id = p_call) >= 300 then raise exception 'Too many signals'; end if;
  insert into public.call_signals (call_id, from_id, to_id, kind, payload)
  values (p_call, me, case when c.caller_id = me then c.callee_id else c.caller_id end, p_kind, p_payload);
end;
$$;

create or replace function public.hide_call_history()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.calls set caller_hidden = true where caller_id = auth.uid();
  update public.calls set callee_hidden = true where callee_id = auth.uid();
  delete from public.calls where caller_hidden and callee_hidden;
end;
$$;

-- ---------- permissions ----------
do $$
declare f text;
begin
  foreach f in array array[
    'set_story_sharing(boolean)','set_read_receipts(boolean)','mark_room_read(uuid)','get_room_reads(uuid)',
    'get_unread_counts()','story_visible(uuid)','mark_story_viewed(uuid)','get_story_viewers(uuid)','report_story(uuid,text)',
    'storage_story_read_ok(text)','storage_story_delete_ok(text)','storage_story_quota_ok()',
    'start_call(uuid,text)','answer_call(uuid)','decline_call(uuid)','end_call(uuid)',
    'send_call_signal(uuid,text,jsonb)','hide_call_history()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- realtime (respects RLS) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.calls;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.call_signals; exception when duplicate_object then null; end;
end $$;
