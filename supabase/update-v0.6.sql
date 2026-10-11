-- =====================================================================
-- LSDKChat update v0.6: reply to a specific message.
-- Run ONCE in Supabase -> SQL Editor, AFTER the v0.3, v0.4 and v0.5 files.
-- NON-destructive and safe to run again.
-- A reply points at an earlier message in the SAME chat (checked here, not only in the app).
-- If the original is later deleted the reply stays and shows "Original message deleted".
-- =====================================================================
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
create index if not exists messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

create or replace function public.messages_check_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reply_to is not null and not exists (
       select 1 from public.messages m where m.id = new.reply_to and m.room_id = new.room_id) then
    raise exception 'You can only reply to a message in the same chat.';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_check_reply on public.messages;
create trigger messages_check_reply before insert on public.messages
  for each row execute function public.messages_check_reply();
revoke all on function public.messages_check_reply() from public, anon, authenticated;
