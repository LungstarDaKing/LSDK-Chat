-- =====================================================================
-- LSDKChat update v0.8: new look + chat list previews.
-- Run ONCE in Supabase -> SQL Editor, AFTER the v0.3 - v0.7 files.
-- NON-destructive and safe to run again.
-- Adds one read-only function that returns the latest message of each of your chats
-- (shown as a preview line in the chat list). It only ever returns chats you are in.
-- =====================================================================
create or replace function public.get_room_previews()
returns table (room_id uuid, sender_id uuid, content text, created_at timestamptz,
               attachment_type text, attachment_name text)
language sql stable security invoker set search_path = '' as $$
  select distinct on (m.room_id) m.room_id, m.sender_id, left(m.content, 140), m.created_at, m.attachment_type, m.attachment_name
  from public.messages m
  order by m.room_id, m.created_at desc;
$$;
revoke all on function public.get_room_previews() from public, anon;
grant execute on function public.get_room_previews() to authenticated;
