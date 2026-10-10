-- =====================================================================
-- LSDKChat update v0.3: profile pictures + bios, online / last seen
-- (with hide options), and sending photos / video / audio / PDFs.
--
-- Run ONCE in Supabase -> SQL Editor.  NON-destructive: chats, users and
-- messages are kept.  Safe to run again if you are unsure it worked.
--
-- Privacy design
--   * Online / last-seen live in a separate table nobody can read except
--     the owner; other people only get answers through get_statuses(),
--     which enforces the hide settings on the SERVER (not in the browser).
--   * Files live in PRIVATE storage buckets; only room members can read /
--     upload room files, enforced by storage policies below.
-- =====================================================================

-- ---------- profiles: bio + avatar ----------
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists bio_length;
alter table public.profiles add constraint bio_length check (bio is null or char_length(bio) <= 160);
alter table public.profiles drop constraint if exists avatar_path_format;
alter table public.profiles add constraint avatar_path_format
  check (avatar_path is null or avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$');

grant update (username, bio, avatar_path) on public.profiles to authenticated;

-- A user may only point avatar_path at a file inside their OWN folder.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
              and (avatar_path is null or split_part(avatar_path, '/', 1) = id::text));

-- ---------- private presence settings ----------
create table if not exists public.user_private (
  id             uuid primary key references public.profiles(id) on delete cascade,
  show_online    boolean not null default true,
  show_last_seen boolean not null default true,
  last_seen_at   timestamptz
);
alter table public.user_private enable row level security;
revoke all on public.user_private from anon, authenticated;
grant select on public.user_private to authenticated;
drop policy if exists user_private_select_own on public.user_private;
create policy user_private_select_own on public.user_private
  for select to authenticated using (id = auth.uid());

create or replace function public.create_user_private()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_private (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_profile_created on public.profiles;
create trigger on_profile_created after insert on public.profiles
  for each row execute function public.create_user_private();
revoke all on function public.create_user_private() from public, anon, authenticated;

insert into public.user_private (id) select id from public.profiles on conflict do nothing;

-- "I'm here" ping (at most once per 20 s per user).
create or replace function public.heartbeat()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.user_private set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '20 seconds');
end;
$$;

create or replace function public.set_privacy(p_online boolean, p_last_seen boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_online is null or p_last_seen is null then raise exception 'Invalid setting'; end if;
  -- last seen would reveal when you are online, so it needs online status to be on
  update public.user_private
     set show_online = p_online, show_last_seen = (p_online and p_last_seen)
   where id = auth.uid();
end;
$$;

-- Who may learn what:
--   * only people who share at least one room with the target
--   * the target must have chosen to show online (and last seen)
--   * reciprocity: if YOU hide online / last seen you cannot see others' either
create or replace function public.get_statuses(p_ids uuid[])
returns table (id uuid, online boolean, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_online boolean;
  my_seen boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if coalesce(array_length(p_ids, 1), 0) > 100 then raise exception 'Too many ids'; end if;
  select mp.show_online, (mp.show_online and mp.show_last_seen)
    into my_online, my_seen from public.user_private mp where mp.id = me;
  if not coalesce(my_online, false) then return; end if;
  return query
    select u.id,
           (u.last_seen_at is not null and u.last_seen_at > now() - interval '90 seconds'),
           case when u.show_last_seen and coalesce(my_seen, false) then u.last_seen_at end
    from public.user_private u
    where u.id = any (p_ids) and u.id <> me and u.show_online
      and exists (select 1 from public.participants a
                  join public.participants b on b.room_id = a.room_id
                  where a.profile_id = me and b.profile_id = u.id);
end;
$$;

-- ---------- messages: attachments ----------
alter table public.messages add column if not exists attachment_path text;
alter table public.messages add column if not exists attachment_name text;
alter table public.messages add column if not exists attachment_type text;
alter table public.messages add column if not exists attachment_size integer;

alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages add constraint messages_content_check
  check (char_length(content) <= 1000
         and (attachment_path is not null or char_length(btrim(content)) >= 1));

alter table public.messages drop constraint if exists messages_attachment_check;
alter table public.messages add constraint messages_attachment_check check (
  (attachment_path is null and attachment_name is null and attachment_type is null and attachment_size is null)
  or (
    attachment_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$'
    and split_part(attachment_path, '/', 1) = room_id::text
    and split_part(attachment_path, '/', 2) = sender_id::text
    and attachment_type in ('image/jpeg','image/png','image/gif','image/webp',
        'video/mp4','video/webm','video/quicktime',
        'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac',
        'application/pdf','text/plain')
    and attachment_size between 1 and 20971520
    and char_length(attachment_name) between 1 and 120
  )
);

-- The referenced file must really exist in the media bucket.
create or replace function public.messages_check_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.attachment_path is not null and not exists (
       select 1 from storage.objects where bucket_id = 'media' and name = new.attachment_path) then
    raise exception 'Attachment upload not found. Please try again.';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_check_attachment on public.messages;
create trigger messages_check_attachment before insert on public.messages
  for each row execute function public.messages_check_attachment();
revoke all on function public.messages_check_attachment() from public, anon, authenticated;

-- ---------- reports: remember the attachment ----------
alter table public.reports add column if not exists attachment_path text;
create or replace function public.report_message(p_message uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if not found or not public.is_room_member(m.room_id) then raise exception 'Message not found'; end if;
  if m.sender_id = auth.uid() then raise exception 'You cannot report your own message'; end if;
  insert into public.reports (reporter_id, message_id, reported_user_id, message_snapshot, reason, attachment_path)
  values (auth.uid(), m.id, m.sender_id,
          m.content || case when m.attachment_path is not null then ' [attachment: ' || m.attachment_name || ']' else '' end,
          btrim(p_reason), m.attachment_path);
end;
$$;

-- ---------- storage buckets (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', false, 1048576, array['image/jpeg']),
  ('media',   'media',   false, 20971520, array[
     'image/jpeg','image/png','image/gif','image/webp',
     'video/mp4','video/webm','video/quicktime',
     'audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','audio/aac',
     'application/pdf','text/plain'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- helpers used by the storage policies (cast safely, never throw)
create or replace function public.storage_room_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_room_member(split_part(p_name, '/', 1)::uuid) else false end;
$$;
create or replace function public.storage_room_admin_ok(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_room_admin(split_part(p_name, '/', 1)::uuid) else false end;
$$;
-- at most 300 files per person (stops someone filling your free storage)
create or replace function public.storage_media_quota_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select count(*) from storage.objects
          where bucket_id = 'media' and split_part(name, '/', 2) = auth.uid()::text) < 300;
$$;
revoke all on function public.storage_room_ok(text), public.storage_room_admin_ok(text),
  public.storage_media_quota_ok() from public, anon;
grant execute on function public.storage_room_ok(text), public.storage_room_admin_ok(text),
  public.storage_media_quota_ok() to authenticated;

-- ---------- storage policies ----------
drop policy if exists lsdk_avatars_read   on storage.objects;
drop policy if exists lsdk_avatars_insert on storage.objects;
drop policy if exists lsdk_avatars_delete on storage.objects;
drop policy if exists lsdk_media_read     on storage.objects;
drop policy if exists lsdk_media_insert   on storage.objects;
drop policy if exists lsdk_media_delete   on storage.objects;

create policy lsdk_avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy lsdk_avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');
create policy lsdk_avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy lsdk_media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.storage_room_ok(name));
create policy lsdk_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'media'
    and public.storage_room_ok(name)
    and split_part(name, '/', 2) = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
    and public.storage_media_quota_ok());
create policy lsdk_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media'
    and (split_part(name, '/', 2) = auth.uid()::text or public.storage_room_admin_ok(name)));

-- ---------- RPC permissions ----------
do $$
declare f text;
begin
  foreach f in array array['heartbeat()', 'set_privacy(boolean,boolean)', 'get_statuses(uuid[])', 'report_message(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
