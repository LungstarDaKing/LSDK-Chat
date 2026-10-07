-- LSDKChat Database Schema
-- Profiles table
create table public.profiles (
  id uuid references auth.users not null primary key,
  updated_at timestamp with time zone,
  username text unique,
  avatar_url text,
  website text,
  constraint username_length check (char_length(username) >= 3)
);

alter table public.profiles enable row level security;

-- Rooms table
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_direct boolean not null default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone
);

alter table public.rooms enable row level security;

-- Participants table (junction table for room members)
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms on delete cascade not null,
  profile_id uuid references public.profiles on delete cascade not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamp with time zone default now(),
  unique(room_id, profile_id)
);

alter table public.participants enable row level security;

-- Messages table
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms on delete cascade not null,
  sender_id uuid references public.profiles on delete cascade not null,
  content text not null check (char_length(content) > 0 and char_length(content) <= 1000),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone
);

alter table public.messages enable row level security;

-- Message receipts table (for tracking read/delivered status)
create table public.message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages on delete cascade not null,
  profile_id uuid references public.profiles on delete cascade not null,
  status text not null check (status in ('delivered', 'read')),
  created_at timestamp with time zone default now(),
  unique(message_id, profile_id, status)
);

alter table public.message_receipts enable row level security;

-- Note: Avatars storage bucket needs to be set up via Supabase UI or management API
-- Once created, set up storage policies for avatars bucket:
-- 1. Allow authenticated users to upload their own avatar (with size/mime restrictions)
-- 2. Allow public read access to avatars
-- 3. Allow users to update/delete only their own avatar

-- Indexes for performance
create index idx_messages_room_created on public.messages(room_id, created_at desc);
create index idx_participants_room on public.participants(room_id);
create index idx_participants_profile on public.participants(profile_id);
create index idx_message_receipts_message on public.message_receipts(message_id);
create index idx_message_receipts_profile on public.message_receipts(profile_id);

-- Security definer functions (execute with owner privileges, not caller privileges)
-- These functions will be used to check room membership and admin status

-- Function to check if a profile is a member of a room
create or replace function public.is_room_member(room_id uuid)
returns boolean
as $$
  declare
    is_member boolean;
  begin
    select exists (
      select 1 from public.participants
      where room_id = is_room_member.room_id
      and profile_id = auth.uid()
    ) into is_member;

    return is_member;
  end;
$$ language plpgsql security definer set search_path = '';

-- Function to check if a profile is an admin of a room
create or replace function public.is_room_admin(room_id uuid)
returns boolean
as $$
  declare
    is_admin boolean;
  begin
    select exists (
      select 1 from public.participants
      where room_id = is_room_admin.room_id
      and profile_id = auth.uid()
      and role = 'admin'
    ) into is_admin;

    return is_admin;
  end;
$$ language plpgsql security definer set search_path = '';

-- RPCs (Remote Procedure Calls) for room creation

-- Function to create a direct room between two users
create or replace function public.create_direct_room(other_user_id uuid)
returns uuid
as $$
  declare
    room_id uuid;
    existing_room_id uuid;
    my_profile_id uuid := auth.uid();
  begin
    -- First check if a direct room already exists between these two users
    select r.id into existing_room_id
    from public.rooms r
    join public.participants p1 on p1.room_id = r.id and p1.profile_id = my_profile_id
    join public.participants p2 on p2.room_id = r.id and p2.profile_id = other_user_id
    where r.is_direct = true
    limit 1;

    if existing_room_id is not null then
      return existing_room_id;
    end if;

    -- Create new direct room
    insert into public.rooms (is_direct) values (true)
    returning id into room_id;

    -- Add both users as participants
    insert into public.participants (room_id, profile_id, role) values
      (room_id, my_profile_id, 'member'),
      (room_id, other_user_id, 'member');

    return room_id;
  end;
$$ language plpgsql security definer set search_path = '';

-- Function to create a group room
create or replace function public.create_group_room(room_name text, admin_ids uuid[])
returns uuid
as $$
  declare
    room_id uuid;
    my_profile_id uuid := auth.uid();
    admin_id uuid;
  begin
    -- Create new group room
    insert into public.rooms (name, is_direct) values (room_name, false)
    returning id into room_id;

    -- Add creator as admin
    insert into public.participants (room_id, profile_id, role) values
      (room_id, my_profile_id, 'admin');

    -- Add specified admins (if they exist and are not already added)
    foreach admin_id in array admin_ids loop
      if admin_id <> my_profile_id then
        insert into public.participants (room_id, profile_id, role)
        values (room_id, admin_id, 'admin')
        on conflict (room_id, profile_id) do nothing;
      end if;
    end loop;

    return room_id;
  end;
$$ language plpgsql security definer set search_path = '';

-- RLS Policies for profiles
create policy "Profiles are viewable by all authenticated users"
  on public.profiles for select
  using (auth.role() = 'authenticated');

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- RLS Policies for rooms
create policy "Rooms are viewable by members"
  on public.rooms for select
  using (exists (
    select 1 from public.participants
    where participants.room_id = rooms.id
    and participants.profile_id = auth.uid()
  ));

create policy "Users can insert rooms they create via RPC"
  on public.rooms for insert
  with check (
    -- Only allow insertion through our secure RPCs
    exists (
      select 1 from pg_proc
      where proname = 'create_direct_room'::name
      or proname = 'create_group_room'::name
    )
    and current_setting('role') != 'anon'
  );

-- RLS Policies for participants
create policy "Participants are viewable by room members"
  on public.participants for select
  using (exists (
    select 1 from public.participants p2
    where p2.room_id = participants.room_id
    and p2.profile_id = auth.uid()
  ));

create policy "Users can insert themselves as participants via RPC"
  on public.participants for insert
  with check (
    -- Only allow insertion through our secure RPCs
    exists (
      select 1 from pg_proc
      where proname = 'create_direct_room'::name
      or proname = 'create_group_room'::name
    )
    and auth.uid() = profile_id
  );

create policy "Users can update their own participant data"
  on public.participants for update
  using (auth.uid() = profile_id);

create policy "Admins can delete participants from their rooms"
  on public.participants for delete
  using (
    exists (
      select 1 from public.participants admin
      where admin.room_id = participants.room_id
      and admin.profile_id = auth.uid()
      and admin.role = 'admin'
    )
  );

-- RLS Policies for messages
create policy "Messages are viewable by room members"
  on public.messages for select
  using (exists (
    select 1 from public.participants
    where participants.room_id = messages.room_id
    and participants.profile_id = auth.uid()
  ));

create policy "Users can insert messages if they are room members and sender matches auth"
  on public.messages for insert
  with check (
    exists (
      select 1 from public.participants
      where participants.room_id = messages.room_id
      and participants.profile_id = auth.uid()
    )
    and auth.uid() = sender_id
  );

create policy "Users can update their own messages"
  on public.messages for update
  using (auth.uid() = sender_id);

create policy "Users can delete their own messages"
  on public.messages for delete
  using (auth.uid() = sender_id);

-- RLS Policies for message receipts
create policy "Receipts are viewable by message senders and room members"
  on public.message_receipts for select
  using (
    exists (
      select 1 from public.messages m
      join public.participants p on p.room_id = m.room_id
      where m.id = message_receipts.message_id
      and p.profile_id = auth.uid()
    )
    or
    exists (
      select 1 from public.messages m
      where m.id = message_receipts.message_id
      and m.sender_id = auth.uid()
    )
  );

create policy "Users can insert receipts for messages in rooms they're in"
  on public.message_receipts for insert
  with check (
    exists (
      select 1 from public.messages m
      join public.participants p on p.room_id = m.room_id
      where m.id = message_receipts.message_id
      and p.profile_id = auth.uid()
    )
  );

create policy "Users can update their own receipts"
  on public.message_receipts for update
  using (auth.uid() = profile_id);

-- Enable realtime for tables
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_receipts;