-- =====================================================================
-- LSDKChat database schema  (v0.2)
-- Run this ONCE in Supabase Dashboard -> SQL Editor.
--
-- !! DESTRUCTIVE: it drops the old LSDKChat tables first, so any test
-- !! chat data already in the project is deleted. Auth users are kept,
-- !! but profiles are re-created for them at the bottom of this file.
--
-- Security model
--   * Row Level Security (RLS) is the ONLY thing protecting data, because
--     the publishable key in the browser is public by design.
--   * Browsers can only READ rooms/participants. Every write to those goes
--     through SECURITY DEFINER functions that check permissions.
--   * Messages: members can read/insert; senders can edit/delete their own;
--     room admins can delete messages in their room.
-- =====================================================================

-- ---------- clean slate ----------
drop table if exists public.reports      cascade;
drop table if exists public.message_receipts cascade;
drop table if exists public.messages     cascade;
drop table if exists public.participants cascade;
drop table if exists public.rooms        cascade;
drop table if exists public.profiles     cascade;
drop function if exists public.is_room_member(uuid)  cascade;
drop function if exists public.is_room_admin(uuid)   cascade;
drop function if exists public.create_direct_room(uuid) cascade;
drop function if exists public.create_group_room(text, uuid[]) cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.messages_before_update() cascade;
drop function if exists public.messages_rate_limit() cascade;
drop function if exists public.messages_after_insert() cascade;
drop function if exists public.rename_room(uuid, text) cascade;
drop function if exists public.add_room_member(uuid, uuid) cascade;
drop function if exists public.remove_room_member(uuid, uuid) cascade;
drop function if exists public.set_member_role(uuid, uuid, text) cascade;
drop function if exists public.leave_room(uuid) cascade;
drop function if exists public.report_message(uuid, text) cascade;
drop function if exists public.accept_terms(text) cascade;
drop function if exists public.delete_my_account() cascade;

-- ---------- tables ----------
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text not null,
  terms_version      text,                       -- which Terms/Privacy version the user accepted
  terms_accepted_at  timestamptz,
  created_at         timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
create unique index profiles_username_lower_idx on public.profiles (lower(username));

create table public.rooms (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  is_direct        boolean not null default false,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now(),
  constraint room_name_rule check (
    (is_direct and name is null)
    or (not is_direct and name is not null and char_length(btrim(name)) between 1 and 60)
  )
);

create table public.participants (
  room_id     uuid not null references public.rooms(id)    on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('admin','member')),
  joined_at   timestamptz not null default now(),
  primary key (room_id, profile_id)
);
create index participants_profile_idx on public.participants (profile_id);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id)    on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);
create index messages_room_created_idx on public.messages (room_id, created_at desc);

-- Abuse reports. A snapshot of the reported text is kept so a moderator can
-- still review it if the sender later edits/deletes the message.
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid references public.profiles(id) on delete set null,
  message_id       uuid references public.messages(id) on delete set null,
  reported_user_id uuid references public.profiles(id) on delete set null,
  message_snapshot text not null,
  reason           text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
);

-- ---------- lock everything down, then grant only what is needed ----------
alter table public.profiles     enable row level security;
alter table public.rooms        enable row level security;
alter table public.participants enable row level security;
alter table public.messages     enable row level security;
alter table public.reports      enable row level security;   -- no policies = nobody via API; read in dashboard

revoke all on public.profiles, public.rooms, public.participants, public.messages, public.reports
  from anon, authenticated;

grant select on public.profiles, public.rooms, public.participants to authenticated;
grant update (username) on public.profiles to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant update (content) on public.messages to authenticated;

-- ---------- helper functions (SECURITY DEFINER avoids RLS recursion) ----------
create function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.participants
                 where room_id = p_room and profile_id = auth.uid());
$$;

create function public.is_room_admin(p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.participants
                 where room_id = p_room and profile_id = auth.uid() and role = 'admin');
$$;

-- ---------- RLS policies ----------
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy rooms_select on public.rooms
  for select to authenticated using (public.is_room_member(id));

create policy participants_select on public.participants
  for select to authenticated using (public.is_room_member(room_id));

create policy messages_select on public.messages
  for select to authenticated using (public.is_room_member(room_id));
create policy messages_insert on public.messages
  for insert to authenticated
  with check (sender_id = auth.uid() and public.is_room_member(room_id));
create policy messages_update_own on public.messages
  for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy messages_delete on public.messages
  for delete to authenticated
  using (sender_id = auth.uid() or public.is_room_admin(room_id));

-- ---------- triggers ----------
-- Create a profile for every new auth user. Username comes from signup
-- metadata but is re-validated here; falls back to a generated one.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidate text := coalesce(new.raw_user_meta_data ->> 'username', '');
  tv        text := nullif(new.raw_user_meta_data ->> 'terms_version', '');
begin
  if candidate !~ '^[A-Za-z0-9_]{3,20}$'
     or exists (select 1 from public.profiles where lower(username) = lower(candidate)) then
    candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username, terms_version, terms_accepted_at)
  values (new.id, candidate, tv, case when tv is not null then now() end);
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp edits, and stop content edits from touching anything else.
create function public.messages_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.edited_at := now();
  return new;
end;
$$;
create trigger messages_before_update
  before update on public.messages
  for each row when (old.content is distinct from new.content)
  execute function public.messages_before_update();

-- Simple flood control: max 15 messages per 10 seconds per user.
create function public.messages_rate_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages
      where sender_id = new.sender_id and created_at > now() - interval '10 seconds') >= 15 then
    raise exception 'You are sending messages too quickly. Please wait a moment.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.messages_rate_limit();

-- Keep rooms.last_message_at fresh (used to sort the room list).
create function public.messages_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.rooms set last_message_at = new.created_at where id = new.room_id;
  return new;
end;
$$;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------- RPCs (the only way browsers change rooms / membership) ----------
create function public.create_direct_room(other_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'Choose someone else to chat with';
  end if;
  if not exists (select 1 from public.profiles where id = other_user_id) then
    raise exception 'User not found';
  end if;

  select r.id into rid
  from public.rooms r
  join public.participants a on a.room_id = r.id and a.profile_id = me
  join public.participants b on b.room_id = r.id and b.profile_id = other_user_id
  where r.is_direct
  limit 1;
  if rid is not null then return rid; end if;

  insert into public.rooms (is_direct, created_by) values (true, me) returning id into rid;
  insert into public.participants (room_id, profile_id, role)
  values (rid, me, 'member'), (rid, other_user_id, 'member');
  return rid;
end;
$$;

create function public.create_group_room(room_name text, member_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  rid uuid;
  m uuid;
  n text := btrim(coalesce(room_name, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(n) < 1 or char_length(n) > 60 then
    raise exception 'Room name must be 1-60 characters';
  end if;
  if coalesce(array_length(member_ids, 1), 0) > 49 then
    raise exception 'Too many members (max 50 including you)';
  end if;

  insert into public.rooms (name, is_direct, created_by) values (n, false, me) returning id into rid;
  insert into public.participants (room_id, profile_id, role) values (rid, me, 'admin');

  foreach m in array coalesce(member_ids, '{}') loop
    if m <> me and exists (select 1 from public.profiles where id = m) then
      insert into public.participants (room_id, profile_id, role)
      values (rid, m, 'member') on conflict do nothing;
    end if;
  end loop;
  return rid;
end;
$$;

create function public.rename_room(p_room uuid, new_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare n text := btrim(coalesce(new_name, ''));
begin
  if not public.is_room_admin(p_room) then raise exception 'Only room admins can do that'; end if;
  if char_length(n) < 1 or char_length(n) > 60 then raise exception 'Room name must be 1-60 characters'; end if;
  update public.rooms set name = n where id = p_room and not is_direct;
end;
$$;

create function public.add_room_member(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_admin(p_room) then raise exception 'Only room admins can do that'; end if;
  if (select is_direct from public.rooms where id = p_room) then
    raise exception 'Direct chats cannot have more members';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'User not found'; end if;
  if (select count(*) from public.participants where room_id = p_room) >= 50 then
    raise exception 'Room is full (50 members)';
  end if;
  insert into public.participants (room_id, profile_id, role)
  values (p_room, p_user, 'member') on conflict do nothing;
end;
$$;

create function public.remove_room_member(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_admin(p_room) then raise exception 'Only room admins can do that'; end if;
  if p_user = auth.uid() then raise exception 'Use "Leave room" to remove yourself'; end if;
  delete from public.participants
  where room_id = p_room and profile_id = p_user
    and exists (select 1 from public.rooms where id = p_room and not is_direct);
end;
$$;

create function public.set_member_role(p_room uuid, p_user uuid, new_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_room_admin(p_room) then raise exception 'Only room admins can do that'; end if;
  if new_role not in ('admin','member') then raise exception 'Invalid role'; end if;
  if p_user = auth.uid() and new_role = 'member'
     and (select count(*) from public.participants where room_id = p_room and role = 'admin') <= 1 then
    raise exception 'A room needs at least one admin';
  end if;
  update public.participants set role = new_role
  where room_id = p_room and profile_id = p_user
    and exists (select 1 from public.rooms where id = p_room and not is_direct);
end;
$$;

-- Leaving: if you were the only admin, the longest-standing member becomes admin;
-- if nobody is left the room (and its messages) is deleted.
create function public.leave_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not public.is_room_member(p_room) then raise exception 'You are not in this room'; end if;
  if (select is_direct from public.rooms where id = p_room) then
    raise exception 'Direct chats cannot be left';
  end if;
  delete from public.participants where room_id = p_room and profile_id = me;
  if not exists (select 1 from public.participants where room_id = p_room) then
    delete from public.rooms where id = p_room;
  elsif not exists (select 1 from public.participants where room_id = p_room and role = 'admin') then
    update public.participants set role = 'admin'
    where (room_id, profile_id) = (
      select room_id, profile_id from public.participants
      where room_id = p_room order by joined_at asc limit 1);
  end if;
end;
$$;

create function public.report_message(p_message uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if not found or not public.is_room_member(m.room_id) then raise exception 'Message not found'; end if;
  if m.sender_id = auth.uid() then raise exception 'You cannot report your own message'; end if;
  insert into public.reports (reporter_id, message_id, reported_user_id, message_snapshot, reason)
  values (auth.uid(), m.id, m.sender_id, m.content, btrim(p_reason));
end;
$$;

create function public.accept_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_version is null or char_length(p_version) > 40 then raise exception 'Invalid version'; end if;
  update public.profiles set terms_version = p_version, terms_accepted_at = now() where id = auth.uid();
end;
$$;

-- Permanently deletes the caller's account, profile, memberships and messages.
create function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- Only signed-in users may call the RPCs (functions are PUBLIC-executable by default).
do $$
declare f text;
begin
  foreach f in array array[
    'is_room_member(uuid)','is_room_admin(uuid)','create_direct_room(uuid)',
    'create_group_room(text,uuid[])','rename_room(uuid,text)','add_room_member(uuid,uuid)',
    'remove_room_member(uuid,uuid)','set_member_role(uuid,uuid,text)','leave_room(uuid)',
    'report_message(uuid,text)','accept_terms(text)','delete_my_account()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- Trigger-only functions must not be callable from the API at all.
revoke all on function public.handle_new_user()        from public, anon, authenticated;
revoke all on function public.messages_rate_limit()    from public, anon, authenticated;
revoke all on function public.messages_after_insert()  from public, anon, authenticated;
revoke all on function public.messages_before_update() from public, anon, authenticated;

-- ---------- realtime (respects RLS) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.messages;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.participants; exception when duplicate_object then null; end;
end $$;

-- ---------- back-fill profiles for users that already exist ----------
insert into public.profiles (id, username)
select u.id, 'user_' || substr(replace(u.id::text, '-', ''), 1, 8)
from auth.users u
on conflict (id) do nothing;
