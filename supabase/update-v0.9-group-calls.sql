-- =====================================================================
-- LSDKChat v0.8 - GROUP CALLS (voice / video)
-- Run this ONCE in Supabase Dashboard -> SQL Editor, AFTER update-v0.7.sql.
-- It only ADDS new tables and functions. Nothing existing is changed or deleted,
-- so one-to-one calls, chats and statuses keep working exactly as before.
--
-- How it works
--   * Anyone in a group chat can start a call. Every other member is invited (rings).
--   * People can accept, decline, or join late while the call is running.
--   * Audio/video go directly between the phones (peer to peer, through the TURN relay
--     when a network blocks direct connections). The database only carries the member list
--     and the connection set-up messages ("signals").
--   * Maximum 6 people in the call at the same time (peer-to-peer gets heavy above that).
--   * Every joined person sends a "ping" every 15 seconds. Someone silent for 45 seconds
--     is treated as gone, so a crashed browser can never keep a call alive forever.
-- =====================================================================

create table if not exists public.group_calls (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  started_by  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('voice','video')),
  created_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists group_calls_room_idx on public.group_calls (room_id, created_at desc);

create table if not exists public.group_call_members (
  call_id     uuid not null references public.group_calls(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id)    on delete cascade,
  state       text not null default 'ringing' check (state in ('ringing','joined','declined','missed','left')),
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  left_at     timestamptz,
  last_seen   timestamptz,
  hidden      boolean not null default false,
  primary key (call_id, profile_id)
);
create index if not exists group_call_members_profile_idx on public.group_call_members (profile_id, invited_at desc);

create table if not exists public.group_call_signals (
  id          uuid primary key default gen_random_uuid(),
  call_id     uuid not null references public.group_calls(id) on delete cascade,
  from_id     uuid not null references public.profiles(id)    on delete cascade,
  to_id       uuid not null references public.profiles(id)    on delete cascade,
  kind        text not null check (kind in ('offer','answer','candidate')),
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists group_call_signals_call_idx on public.group_call_signals (call_id);
create index if not exists group_call_signals_to_idx   on public.group_call_signals (to_id, created_at);

alter table public.group_calls         enable row level security;
alter table public.group_call_members  enable row level security;
alter table public.group_call_signals  enable row level security;
revoke all on public.group_calls, public.group_call_members, public.group_call_signals from anon, authenticated;
grant select on public.group_calls, public.group_call_members, public.group_call_signals to authenticated;

-- helper (SECURITY DEFINER avoids RLS recursion): am I on the member list of this call?
create or replace function public.is_group_call_member(p_call uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_call_members where call_id = p_call and profile_id = auth.uid());
$$;

drop policy if exists group_calls_select on public.group_calls;
create policy group_calls_select on public.group_calls for select to authenticated
  using (public.is_group_call_member(id));
drop policy if exists group_call_members_select on public.group_call_members;
create policy group_call_members_select on public.group_call_members for select to authenticated
  using (public.is_group_call_member(call_id));
drop policy if exists group_call_signals_select on public.group_call_signals;
create policy group_call_signals_select on public.group_call_signals for select to authenticated
  using (to_id = auth.uid());

-- ---------- internal: tidy one call (not callable from the browser) ----------
create or replace function public.gc_cleanup(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- nobody answered within 60 seconds -> missed
  update public.group_call_members set state = 'missed'
   where call_id = p_call and state = 'ringing' and invited_at < now() - interval '60 seconds';
  -- silent for 45 seconds -> gone
  update public.group_call_members set state = 'left', left_at = now()
   where call_id = p_call and state = 'joined' and coalesce(last_seen, joined_at, invited_at) < now() - interval '45 seconds';
  -- nobody is in the call any more -> it is over
  if not exists (select 1 from public.group_call_members where call_id = p_call and state = 'joined') then
    update public.group_calls set ended_at = now() where id = p_call and ended_at is null;
    delete from public.group_call_signals where call_id = p_call;
  end if;
end;
$$;

-- ---------- start (or find the call already running in this group) ----------
create or replace function public.start_group_call(p_room uuid, p_kind text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  r public.rooms%rowtype;
  existing uuid;
  cid uuid;
  c record;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_kind not in ('voice','video') then raise exception 'Invalid call type'; end if;

  select * into r from public.rooms where id = p_room;
  if not found or r.is_direct or r.notes_owner is not null
     or not exists (select 1 from public.participants where room_id = p_room and profile_id = me) then
    raise exception 'Group calls are only available inside group chats you belong to.';
  end if;
  if (select count(*) from public.participants where room_id = p_room) < 2 then
    raise exception 'There is nobody else in this group to call.';
  end if;

  -- tidy anything stale that involves this room or me
  for c in select id from public.group_calls
           where ended_at is null and (room_id = p_room
             or id in (select call_id from public.group_call_members where profile_id = me and state = 'joined')) loop
    perform public.gc_cleanup(c.id);
  end loop;
  delete from public.group_calls where created_at < now() - interval '90 days';

  -- a call is already running in this group: hand back its id so the caller just joins it
  select id into existing from public.group_calls
   where room_id = p_room and ended_at is null and created_at > now() - interval '8 hours'
   order by created_at desc limit 1;
  if existing is not null then return existing; end if;

  if exists (select 1 from public.group_call_members m join public.group_calls g on g.id = m.call_id
             where m.profile_id = me and m.state = 'joined' and g.ended_at is null) then
    raise exception 'You are already in a call.';
  end if;
  if exists (select 1 from public.calls
             where (caller_id = me or callee_id = me)
               and ((status = 'ringing' and created_at > now() - interval '60 seconds')
                 or (status = 'accepted' and ended_at is null and created_at > now() - interval '4 hours'))) then
    raise exception 'You are already in a call.';
  end if;
  if (select count(*) from public.group_calls where started_by = me and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Too many calls. Please wait a few minutes.';
  end if;

  insert into public.group_calls (room_id, started_by, kind) values (p_room, me, p_kind) returning id into cid;
  insert into public.group_call_members (call_id, profile_id, state, joined_at, last_seen)
  values (cid, me, 'joined', now(), now());
  insert into public.group_call_members (call_id, profile_id)
  select cid, profile_id from public.participants where room_id = p_room and profile_id <> me;
  return cid;
end;
$$;

-- ---------- join (also used to join late) ----------
create or replace function public.join_group_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  g public.group_calls%rowtype;
  already boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into g from public.group_calls where id = p_call;
  if not found then raise exception 'This call is no longer available.'; end if;
  perform public.gc_cleanup(p_call);
  select * into g from public.group_calls where id = p_call;
  if g.ended_at is not null or g.created_at < now() - interval '8 hours' then
    raise exception 'This call has ended.';
  end if;
  if not exists (select 1 from public.participants where room_id = g.room_id and profile_id = me) then
    raise exception 'You are not a member of this group.';
  end if;

  select exists (select 1 from public.group_call_members where call_id = p_call and profile_id = me and state = 'joined') into already;
  if not already then
    if exists (select 1 from public.group_call_members m join public.group_calls x on x.id = m.call_id
               where m.profile_id = me and m.state = 'joined' and x.ended_at is null and x.id <> p_call) then
      raise exception 'You are already in another call.';
    end if;
    if (select count(*) from public.group_call_members where call_id = p_call and state = 'joined') >= 6 then
      raise exception 'This call is full (6 people at most).';
    end if;
  end if;

  -- fresh start for my connection set-up messages
  delete from public.group_call_signals where call_id = p_call and (from_id = me or to_id = me);

  insert into public.group_call_members (call_id, profile_id, state, joined_at, last_seen)
  values (p_call, me, 'joined', now(), now())
  on conflict (call_id, profile_id) do update
    set state = 'joined', joined_at = coalesce(public.group_call_members.joined_at, now()), left_at = null, last_seen = now();
end;
$$;

create or replace function public.decline_group_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_call_members set state = 'declined'
   where call_id = p_call and profile_id = auth.uid() and state = 'ringing';
end;
$$;

create or replace function public.leave_group_call(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_call_members set state = 'left', left_at = now()
   where call_id = p_call and profile_id = auth.uid() and state = 'joined';
  delete from public.group_call_signals where call_id = p_call and (from_id = auth.uid() or to_id = auth.uid());
  perform public.gc_cleanup(p_call);
end;
$$;

-- every joined person calls this every ~15 seconds; it also tidies stale members
create or replace function public.group_call_ping(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_call_members set last_seen = now()
   where call_id = p_call and profile_id = auth.uid() and state = 'joined';
  if not found then raise exception 'You are not in this call.'; end if;
  perform public.gc_cleanup(p_call);
end;
$$;

create or replace function public.send_group_signal(p_call uuid, p_to uuid, p_kind text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if p_kind not in ('offer','answer','candidate') then raise exception 'Invalid signal'; end if;
  if p_payload is null or octet_length(p_payload::text) > 20000 then raise exception 'Signal too large'; end if;
  if p_to is null or p_to = me then raise exception 'Invalid recipient'; end if;
  if not exists (select 1 from public.group_calls where id = p_call and ended_at is null) then raise exception 'Call not active'; end if;
  if not exists (select 1 from public.group_call_members where call_id = p_call and profile_id = me   and state = 'joined')
     or not exists (select 1 from public.group_call_members where call_id = p_call and profile_id = p_to and state = 'joined') then
    raise exception 'Not in this call';
  end if;
  if (select count(*) from public.group_call_signals where call_id = p_call and from_id = me) >= 600 then
    raise exception 'Too many signals';
  end if;
  insert into public.group_call_signals (call_id, from_id, to_id, kind, payload) values (p_call, me, p_to, p_kind, p_payload);
end;
$$;

create or replace function public.hide_group_call_history()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.group_call_members set hidden = true where profile_id = auth.uid();
end;
$$;

-- ---------- permissions ----------
do $$
declare f text;
begin
  foreach f in array array[
    'start_group_call(uuid,text)','join_group_call(uuid)','decline_group_call(uuid)','leave_group_call(uuid)',
    'group_call_ping(uuid)','send_group_signal(uuid,uuid,text,jsonb)','hide_group_call_history()','is_group_call_member(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helper: nobody can call it from the browser
  revoke all on function public.gc_cleanup(uuid) from public, anon, authenticated;
end $$;

-- ---------- realtime (respects the row rules above) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.group_calls;        exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_call_members; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.group_call_signals; exception when duplicate_object then null; end;
end $$;
