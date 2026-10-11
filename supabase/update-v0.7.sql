-- =====================================================================
-- LSDKChat update v0.7: smart messaging tools.
--   notes to yourself, mark chat as unread, saved messages (collections),
--   reminders on messages, scheduled messages + "send when they come online",
--   search across chats (text, files, links).
-- Run ONCE in Supabase -> SQL Editor, AFTER the v0.3 - v0.6 files.
-- NON-destructive and safe to run again.
-- =====================================================================

-- ---------- notes to myself: a private room with only me in it ----------
alter table public.rooms add column if not exists notes_owner uuid references public.profiles(id) on delete cascade;
create unique index if not exists rooms_notes_owner_uq on public.rooms (notes_owner) where notes_owner is not null;

create or replace function public.participants_block_notes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.rooms r where r.id = new.room_id and r.notes_owner is not null and r.notes_owner <> new.profile_id) then
    raise exception 'Nobody else can be added to your notes.';
  end if;
  return new;
end;
$$;
drop trigger if exists participants_block_notes on public.participants;
create trigger participants_block_notes before insert on public.participants
  for each row execute function public.participants_block_notes();

create or replace function public.get_notes_room()
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); rid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select id into rid from public.rooms where notes_owner = me;
  if rid is not null then return rid; end if;
  begin
    insert into public.rooms (name, is_direct, created_by, notes_owner) values ('Notes to myself', false, me, me) returning id into rid;
    insert into public.participants (room_id, profile_id, role) values (rid, me, 'admin');
  exception when unique_violation then
    select id into rid from public.rooms where notes_owner = me;
  end;
  return rid;
end;
$$;

-- ---------- mark a chat as unread (private to me) ----------
create table if not exists public.room_flags (
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  marked_unread boolean not null default true,
  primary key (profile_id, room_id)
);
alter table public.room_flags enable row level security;
revoke all on public.room_flags from anon, authenticated;
grant select on public.room_flags to authenticated;
drop policy if exists room_flags_select_own on public.room_flags;
create policy room_flags_select_own on public.room_flags for select to authenticated using (profile_id = auth.uid());

create or replace function public.set_marked_unread(p_room uuid, p_value boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_room_member(p_room) then raise exception 'You are not in this chat.'; end if;
  if coalesce(p_value, false) then
    insert into public.room_flags (profile_id, room_id, marked_unread) values (auth.uid(), p_room, true)
    on conflict (profile_id, room_id) do update set marked_unread = true;
  else
    delete from public.room_flags where profile_id = auth.uid() and room_id = p_room;
  end if;
end;
$$;

-- ---------- saved messages in collections ----------
create table if not exists public.saved_items (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  collection text not null default 'Saved' check (char_length(btrim(collection)) between 1 and 30),
  created_at timestamptz not null default now(),
  unique (profile_id, message_id, collection)
);
create index if not exists saved_items_profile_idx on public.saved_items (profile_id, collection);
alter table public.saved_items enable row level security;
revoke all on public.saved_items from anon, authenticated;
grant select, delete on public.saved_items to authenticated;
drop policy if exists saved_items_select_own on public.saved_items;
create policy saved_items_select_own on public.saved_items for select to authenticated using (profile_id = auth.uid());
drop policy if exists saved_items_delete_own on public.saved_items;
create policy saved_items_delete_own on public.saved_items for delete to authenticated using (profile_id = auth.uid());

create or replace function public.save_message(p_message uuid, p_collection text default 'Saved')
returns void language plpgsql security definer set search_path = '' as $$
declare c text := btrim(coalesce(p_collection, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if c = '' then c := 'Saved'; end if;
  if char_length(c) > 30 then raise exception 'Collection names are limited to 30 characters.'; end if;
  if not exists (select 1 from public.messages m where m.id = p_message and public.is_room_member(m.room_id)) then
    raise exception 'Message not found.';
  end if;
  if (select count(*) from public.saved_items where profile_id = auth.uid()) >= 500 then
    raise exception 'You can keep up to 500 saved messages. Remove some first.';
  end if;
  insert into public.saved_items (profile_id, message_id, collection) values (auth.uid(), p_message, c)
  on conflict (profile_id, message_id, collection) do nothing;
end;
$$;

-- ---------- reminders on messages (private; shown by the app when due) ----------
create table if not exists public.message_reminders (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  remind_at  timestamptz not null,
  created_at timestamptz not null default now(),
  unique (profile_id, message_id)
);
create index if not exists message_reminders_due_idx on public.message_reminders (profile_id, remind_at);
alter table public.message_reminders enable row level security;
revoke all on public.message_reminders from anon, authenticated;
grant select, delete on public.message_reminders to authenticated;
drop policy if exists message_reminders_select_own on public.message_reminders;
create policy message_reminders_select_own on public.message_reminders for select to authenticated using (profile_id = auth.uid());
drop policy if exists message_reminders_delete_own on public.message_reminders;
create policy message_reminders_delete_own on public.message_reminders for delete to authenticated using (profile_id = auth.uid());

create or replace function public.set_reminder(p_message uuid, p_when timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_when is null or p_when < now() - interval '1 minute' or p_when > now() + interval '1 year' then
    raise exception 'Choose a time within the next year.';
  end if;
  if not exists (select 1 from public.messages m where m.id = p_message and public.is_room_member(m.room_id)) then
    raise exception 'Message not found.';
  end if;
  if (select count(*) from public.message_reminders where profile_id = auth.uid()) >= 100
     and not exists (select 1 from public.message_reminders where profile_id = auth.uid() and message_id = p_message) then
    raise exception 'You can have up to 100 reminders.';
  end if;
  insert into public.message_reminders (profile_id, message_id, remind_at) values (auth.uid(), p_message, p_when)
  on conflict (profile_id, message_id) do update set remind_at = excluded.remind_at;
end;
$$;

-- ---------- scheduled messages / send when they come online ----------
create table if not exists public.scheduled_messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  content     text not null check (char_length(btrim(content)) between 1 and 1000),
  reply_to    uuid references public.messages(id) on delete set null,
  send_at     timestamptz not null,
  when_online boolean not null default false,
  expires_at  timestamptz not null,
  status      text not null default 'pending' check (status in ('pending','sent','failed','expired')),
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists scheduled_due_idx on public.scheduled_messages (send_at) where status = 'pending';
create index if not exists scheduled_sender_idx on public.scheduled_messages (sender_id, created_at desc);
alter table public.scheduled_messages enable row level security;
revoke all on public.scheduled_messages from anon, authenticated;
grant select, delete on public.scheduled_messages to authenticated;
drop policy if exists scheduled_select_own on public.scheduled_messages;
create policy scheduled_select_own on public.scheduled_messages for select to authenticated using (sender_id = auth.uid());
drop policy if exists scheduled_delete_own on public.scheduled_messages;
create policy scheduled_delete_own on public.scheduled_messages for delete to authenticated using (sender_id = auth.uid());

create or replace function public.schedule_message(p_room uuid, p_content text, p_send_at timestamptz default null,
                                                   p_when_online boolean default false, p_reply_to uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); c text := btrim(coalesce(p_content, '')); sa timestamptz; ex timestamptz; rid uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_room_member(p_room) then raise exception 'You are not in this chat.'; end if;
  if char_length(c) not between 1 and 1000 then raise exception 'Messages must be 1 to 1000 characters.'; end if;
  if (select count(*) from public.scheduled_messages where sender_id = me and status = 'pending') >= 30 then
    raise exception 'You can have up to 30 waiting messages.';
  end if;
  if p_reply_to is not null and not exists (select 1 from public.messages m where m.id = p_reply_to and m.room_id = p_room) then
    raise exception 'You can only reply to a message in the same chat.';
  end if;
  if coalesce(p_when_online, false) then
    if not exists (select 1 from public.rooms r where r.id = p_room and r.is_direct) then
      raise exception 'Sending when someone comes online only works in a direct chat.';
    end if;
    if not coalesce((select u.show_online from public.user_private u where u.id = me), false) then
      raise exception 'Turn on "Show when I am online" in Settings to use this (it works both ways).';
    end if;
    sa := now(); ex := now() + interval '7 days';
  else
    if p_send_at is null or p_send_at <= now() then raise exception 'Choose a time in the future.'; end if;
    if p_send_at > now() + interval '1 year' then raise exception 'Choose a time within the next year.'; end if;
    sa := p_send_at; ex := p_send_at + interval '2 days';
  end if;
  insert into public.scheduled_messages (sender_id, room_id, content, reply_to, send_at, when_online, expires_at)
  values (me, p_room, c, p_reply_to, sa, coalesce(p_when_online, false), ex) returning id into rid;
  return rid;
end;
$$;

-- Internal: sends everything that is due. Called whenever anyone's app sends a heartbeat
-- (and by pg_cron every minute if you have that extension on). Not callable from the browser.
create or replace function public.deliver_due_scheduled()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; peer uuid;
begin
  update public.scheduled_messages set status = 'expired', error = 'Not delivered in time.'
  where status = 'pending' and expires_at < now();
  for r in select * from public.scheduled_messages
           where status = 'pending' and send_at <= now() order by send_at limit 50 for update skip locked loop
    if r.when_online then
      select p.profile_id into peer from public.participants p where p.room_id = r.room_id and p.profile_id <> r.sender_id limit 1;
      if peer is null
         or not exists (select 1 from public.user_private u where u.id = peer and u.show_online and u.last_seen_at > now() - interval '60 seconds')
         or not exists (select 1 from public.user_private u where u.id = r.sender_id and u.show_online) then
        continue;
      end if;
    end if;
    begin
      if not exists (select 1 from public.participants where room_id = r.room_id and profile_id = r.sender_id) then
        raise exception 'You are no longer in this chat.';
      end if;
      insert into public.messages (room_id, sender_id, content, reply_to)
      values (r.room_id, r.sender_id, r.content,
              case when r.reply_to is not null and exists (select 1 from public.messages x where x.id = r.reply_to) then r.reply_to end);
      update public.scheduled_messages set status = 'sent', sent_at = now(), error = null where id = r.id;
      n := n + 1;
    exception when others then
      if sqlerrm like 'You are sending messages too quickly%' then
        null;                                           -- try again next time
      else
        update public.scheduled_messages set status = 'failed', error = left(sqlerrm, 200) where id = r.id;
      end if;
    end;
  end loop;
  delete from public.scheduled_messages
  where status in ('sent','expired','failed') and coalesce(sent_at, created_at) < now() - interval '7 days';
  return n;
end;
$$;

create or replace function public.heartbeat()
returns void language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.user_private set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '20 seconds');
  get diagnostics n = row_count;
  if n > 0 then
    begin perform public.deliver_due_scheduled(); exception when others then null; end;
  end if;
end;
$$;

-- Optional: also deliver every minute even when nobody's app is open (needs the pg_cron extension).
do $$
begin
  begin
    create extension if not exists pg_cron;
    perform cron.schedule('lsdk-deliver-scheduled', '* * * * *', 'select public.deliver_due_scheduled()');
  exception when others then
    raise notice 'pg_cron not enabled - scheduled messages will go out when anyone opens the app (that is fine).';
  end;
end $$;

-- ---------- search across my chats (RLS decides what I may see) ----------
create or replace function public.search_messages(p_q text, p_kind text default 'text', p_limit integer default 40, p_before timestamptz default null)
returns table (id uuid, room_id uuid, sender_id uuid, content text, created_at timestamptz,
               attachment_name text, attachment_type text, attachment_path text)
language plpgsql stable security invoker set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); pat text; lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(q) > 100 then raise exception 'Search text is too long.'; end if;
  if p_kind not in ('text','files','links') then raise exception 'Unknown search type.'; end if;
  if p_kind = 'text' and char_length(q) < 2 then raise exception 'Type at least 2 characters.'; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    select m.id, m.room_id, m.sender_id, m.content, m.created_at, m.attachment_name, m.attachment_type, m.attachment_path
    from public.messages m
    where (p_before is null or m.created_at < p_before)
      and ((p_kind = 'text'  and m.content ilike pat)
        or (p_kind = 'files' and m.attachment_path is not null and (q = '' or m.attachment_name ilike pat or m.content ilike pat))
        or (p_kind = 'links' and m.content ~* 'https?://' and (q = '' or m.content ilike pat)))
    order by m.created_at desc limit lim;
end;
$$;

-- Faster searching (optional; ignored if the extension is unavailable)
do $$
begin
  create extension if not exists pg_trgm;
  execute 'create index if not exists messages_content_trgm on public.messages using gin (content gin_trgm_ops)';
exception when others then raise notice 'pg_trgm not available - search still works, just slower on very large chats.';
end $$;

-- ---------- permissions ----------
do $$
declare f text;
begin
  foreach f in array array['get_notes_room()','set_marked_unread(uuid,boolean)','save_message(uuid,text)','set_reminder(uuid,timestamptz)',
                           'schedule_message(uuid,text,timestamptz,boolean,uuid)','search_messages(text,text,integer,timestamptz)','heartbeat()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.deliver_due_scheduled() from public, anon, authenticated;
  revoke all on function public.participants_block_notes() from public, anon, authenticated;
end $$;
