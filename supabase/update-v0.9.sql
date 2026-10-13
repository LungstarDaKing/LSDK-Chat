-- =====================================================================
-- LSDKChat update v0.9: nicknames.
-- Run ONCE in Supabase -> SQL Editor, AFTER the v0.3 - v0.8 files. Safe to run again.
-- A nickname is something YOU call another person. Only you and that person can ever
-- see it (it is never shown to anyone else, and their real username is never changed).
-- You can only nickname someone you share a chat with.
-- =====================================================================
create table if not exists public.nicknames (
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  target_id  uuid not null references public.profiles(id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id),
  check (owner_id <> target_id)
);
create index if not exists nicknames_target_idx on public.nicknames (target_id);
alter table public.nicknames enable row level security;
revoke all on public.nicknames from anon, authenticated;
grant select on public.nicknames to authenticated;
drop policy if exists nicknames_select on public.nicknames;
create policy nicknames_select on public.nicknames for select to authenticated
  using (owner_id = (select auth.uid()) or target_id = (select auth.uid()));

create or replace function public.set_nickname(p_target uuid, p_nick text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); n text := btrim(coalesce(p_nick, ''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_target = me then raise exception 'You cannot nickname yourself'; end if;
  if not exists (select 1 from public.participants a join public.participants b on a.room_id = b.room_id
                 where a.profile_id = me and b.profile_id = p_target) then
    raise exception 'You can only nickname someone you share a chat with';
  end if;
  if n = '' then
    delete from public.nicknames where owner_id = me and target_id = p_target;
  else
    if char_length(n) > 30 then raise exception 'Nicknames are limited to 30 characters'; end if;
    insert into public.nicknames (owner_id, target_id, nickname) values (me, p_target, n)
    on conflict (owner_id, target_id) do update set nickname = excluded.nickname, updated_at = now();
  end if;
end;
$$;
revoke all on function public.set_nickname(uuid, text) from public, anon;
grant execute on function public.set_nickname(uuid, text) to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.nicknames; exception when duplicate_object then null; when undefined_object then null; end;
end $$;

-- =====================================================================
-- Status comments arrive in your normal chat with the person.
-- A comment on someone's status is now also delivered as a message in your direct chat with
-- them, labelled with the status it was about (so they can reply in the usual way).
-- The label is a short snapshot, so it still makes sense after the status expires.
-- =====================================================================
alter table public.messages add column if not exists status_label text check (status_label is null or char_length(status_label) <= 80);

create or replace function public.comment_on_story(p_story uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.stories%rowtype; cid uuid; t text := btrim(coalesce(p_content, '')); rid uuid; lbl text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(t) not between 1 and 300 then raise exception 'Comments must be 1-300 characters'; end if;
  select * into s from public.stories where id = p_story;
  if not found or s.expires_at <= now() or not public.story_visible(s.author_id) then raise exception 'Status not found'; end if;
  if s.author_id = auth.uid() then raise exception 'You cannot comment on your own status'; end if;
  if (select count(*) from public.story_comments where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many comments. Please wait a little.';
  end if;
  insert into public.story_comments (story_id, user_id, author_id, content) values (p_story, auth.uid(), s.author_id, t) returning id into cid;
  -- also deliver it to the normal chat (never blocks the comment itself)
  begin
    rid := public.create_direct_room(s.author_id);
    lbl := case s.kind when 'text' then 'Status: "' || left(btrim(s.content), 40) || '"'
                       when 'image' then 'Status photo' when 'video' then 'Status video' else 'Status audio' end;
    insert into public.messages (room_id, sender_id, content, status_label) values (rid, auth.uid(), t, lbl);
  exception when others then null;
  end;
  return cid;
end;
$$;
