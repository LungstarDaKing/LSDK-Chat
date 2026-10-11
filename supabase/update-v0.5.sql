-- =====================================================================
-- LSDKChat update v0.5: emoji reactions on messages, likes + comments on
-- status updates.
--
-- Run ONCE in Supabase -> SQL Editor, AFTER update-v0.3.sql and update-v0.4.sql.
-- NON-destructive and safe to run again.
--
-- Privacy design
--   * Message reactions are visible only to members of that chat. One reaction per
--     person per message (pick another to change it, pick the same to remove it).
--   * Status likes are visible only to the status author (and to the person who liked).
--   * Status comments are PRIVATE replies: only the author of the status and the person
--     who wrote the comment can see them.
--   * Everything is enforced here in the database, not in the browser.
-- =====================================================================

-- ---------- message reactions ----------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  room_id    uuid not null references public.rooms(id) on delete cascade,
  emoji      text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_room_idx on public.message_reactions (room_id);

alter table public.message_reactions enable row level security;
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;          -- writes only through react_to_message()
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (public.is_room_member(room_id));

-- The only emojis the app offers (the server refuses anything else).
create or replace function public.reaction_allowed(p_emoji text)
returns boolean language sql immutable set search_path = '' as $$
  select p_emoji = any (array[
    '❤️','👍','👎','😂','😮','😢','🙏','🔥','👏','🎉','😍','🤔','💯','😡','🥳','😎',
    '😀','😃','😄','😁','😆','😅','🤣','🙂','😉','😊','😇','🥰','😘','😋','😜','🤪','😏','😒','😞','😔','😟','😤','😭','😱','😨','😴','🤯','🥺','😳','🤗','🫡','🤝',
    '👌','✌️','🤞','🤟','🤘','👋','💪','🙌','🫶','👀','🧠','✅','❌','⭐','✨','💥','⚡',
    '💔','💕','💖','💗','💙','💚','💛','🧡','💜','🖤','🤍','💘','💝',
    '🐶','🐱','🦁','🐼','🦄','🐢','🦋','🌹','🌈','☀️','🌙','🍀',
    '🍕','🍔','🍟','🍩','🍫','☕','🍻','🎂','⚽','🏆','🎵','🎧','🎮','📚','💡','🚀','💰','🎁'
  ]);
$$;

create or replace function public.react_to_message(p_message uuid, p_emoji text)
returns text language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; cur text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into m from public.messages where id = p_message;
  if not found or not public.is_room_member(m.room_id) then raise exception 'Message not found'; end if;
  if p_emoji is null or not public.reaction_allowed(p_emoji) then raise exception 'That reaction is not available'; end if;
  select emoji into cur from public.message_reactions where message_id = p_message and user_id = auth.uid();
  if cur = p_emoji then
    delete from public.message_reactions where message_id = p_message and user_id = auth.uid();
    return null;
  end if;
  insert into public.message_reactions (message_id, user_id, room_id, emoji)
  values (p_message, auth.uid(), m.room_id, p_emoji)
  on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return p_emoji;
end;
$$;

-- ---------- status likes ----------
create table if not exists public.story_likes (
  story_id  uuid not null references public.stories(id)  on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,   -- the status owner (for notifications)
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);
create index if not exists story_likes_author_idx on public.story_likes (author_id, created_at desc);

-- ---------- status comments (private replies) ----------
create table if not exists public.story_comments (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references public.stories(id)  on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,   -- the status owner
  content    text not null check (char_length(btrim(content)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index if not exists story_comments_story_idx  on public.story_comments (story_id, created_at);
create index if not exists story_comments_author_idx on public.story_comments (author_id, created_at desc);

alter table public.story_likes    enable row level security;
alter table public.story_comments enable row level security;
revoke all on public.story_likes, public.story_comments from anon, authenticated;
grant select on public.story_likes, public.story_comments to authenticated;
grant delete on public.story_comments to authenticated;               -- author or commenter may delete (policy below)

drop policy if exists story_likes_select on public.story_likes;
create policy story_likes_select on public.story_likes for select to authenticated
  using (user_id = auth.uid() or author_id = auth.uid());
drop policy if exists story_comments_select on public.story_comments;
create policy story_comments_select on public.story_comments for select to authenticated
  using (user_id = auth.uid() or author_id = auth.uid());
drop policy if exists story_comments_delete on public.story_comments;
create policy story_comments_delete on public.story_comments for delete to authenticated
  using (user_id = auth.uid() or author_id = auth.uid());

create or replace function public.like_story(p_story uuid, p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare s public.stories%rowtype;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_on is null then raise exception 'Invalid request'; end if;
  select * into s from public.stories where id = p_story;
  if not found or s.expires_at <= now() or not public.story_visible(s.author_id) then raise exception 'Status not found'; end if;
  if s.author_id = auth.uid() then raise exception 'You cannot like your own status'; end if;
  if p_on then
    insert into public.story_likes (story_id, user_id, author_id) values (p_story, auth.uid(), s.author_id) on conflict do nothing;
  else
    delete from public.story_likes where story_id = p_story and user_id = auth.uid();
  end if;
  return p_on;
end;
$$;

create or replace function public.comment_on_story(p_story uuid, p_content text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.stories%rowtype; cid uuid; t text := btrim(coalesce(p_content, ''));
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
  return cid;
end;
$$;

-- What the author of a status sees: who liked it and what they wrote.
create or replace function public.get_story_activity(p_story uuid)
returns table (kind text, id uuid, user_id uuid, username text, content text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stories where stories.id = p_story and author_id = auth.uid()) then
    raise exception 'Status not found';
  end if;
  return query
    select 'like'::text, null::uuid, l.user_id, p.username, null::text, l.created_at
      from public.story_likes l join public.profiles p on p.id = l.user_id where l.story_id = p_story
    union all
    select 'comment'::text, c.id, c.user_id, p.username, c.content, c.created_at
      from public.story_comments c join public.profiles p on p.id = c.user_id where c.story_id = p_story
    order by 6 desc;
end;
$$;

create or replace function public.report_story_comment(p_comment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.story_comments%rowtype;
begin
  select * into c from public.story_comments where id = p_comment and author_id = auth.uid();
  if not found then raise exception 'Comment not found'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then raise exception 'Please describe the problem (max 500 characters)'; end if;
  insert into public.reports (reporter_id, reported_user_id, message_snapshot, reason, story_id)
  values (auth.uid(), c.user_id, '[status comment] ' || c.content, btrim(p_reason), c.story_id);
end;
$$;

-- ---------- permissions ----------
do $$
declare f text;
begin
  foreach f in array array['reaction_allowed(text)','react_to_message(uuid,text)','like_story(uuid,boolean)',
                           'comment_on_story(uuid,text)','get_story_activity(uuid)','report_story_comment(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- realtime (respects the policies above) ----------
do $$ begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.story_likes;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.story_comments;    exception when duplicate_object then null; end;
end $$;
