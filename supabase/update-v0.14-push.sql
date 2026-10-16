-- LSDKChat v0.14: ALERTS WHEN THE APP IS CLOSED (Web Push).
-- Run in Supabase > SQL Editor AFTER update-v0.13.sql. Safe to run twice.
-- Then follow PUSH-SETUP.md (Edge Function + one INSERT into push_config at the very end of this file).

create extension if not exists pg_net with schema extensions;

/* ---------- each person's devices ---------- */
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique check (char_length(endpoint) <= 1000),
  p256dh       text not null,
  auth         text not null,
  show_preview boolean not null default true,
  user_agent   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
alter table public.push_subscriptions enable row level security;   -- no policies: only the functions below and the server can touch it

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text default null, p_show_preview boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or p_p256dh is null or p_auth is null then raise exception 'Bad subscription'; end if;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, show_preview, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_show_preview, true), left(p_ua, 200))
  on conflict (endpoint) do update
    set profile_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        show_preview = excluded.show_preview, user_agent = excluded.user_agent, updated_at = now();
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid();
end $$;

revoke all on function public.save_push_subscription(text, text, text, text, boolean) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text, boolean) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

/* ---------- where to send "something happened" (filled in once, see the end of this file) ---------- */
create table if not exists public.push_config (
  id           int primary key default 1 check (id = 1),
  function_url text not null,
  secret       text not null
);
alter table public.push_config enable row level security;          -- no policies: not readable from the app

create or replace function public.push_fire(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  select * into c from public.push_config where id = 1;
  if not found then return; end if;
  perform net.http_post(url := c.function_url, body := p,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret),
    timeout_milliseconds := 5000);
exception when others then null;                                    -- a failed alert must NEVER block a message or a call
end $$;
revoke all on function public.push_fire(jsonb) from public, anon, authenticated;

/* ---------- triggers ---------- */
create or replace function public.push_on_message() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.push_fire(jsonb_build_object('kind', 'message', 'id', new.id)); return new; end $$;
drop trigger if exists push_message on public.messages;
create trigger push_message after insert on public.messages for each row execute function public.push_on_message();

create or replace function public.push_on_call() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'ringing' then
    perform public.push_fire(jsonb_build_object('kind', 'call', 'id', new.id));
  elsif tg_op = 'UPDATE' and old.status = 'ringing' and new.status = 'missed' then
    perform public.push_fire(jsonb_build_object('kind', 'missed_call', 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists push_call on public.calls;
create trigger push_call after insert or update of status on public.calls for each row execute function public.push_on_call();

create or replace function public.push_on_group_call_member() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'ringing' then
    perform public.push_fire(jsonb_build_object('kind', 'group_call', 'call_id', new.call_id, 'profile_id', new.profile_id));
  end if;
  return new;
end $$;
drop trigger if exists push_group_call_member on public.group_call_members;
create trigger push_group_call_member after insert on public.group_call_members for each row execute function public.push_on_group_call_member();

-- LAST STEP (after deploying the Edge Function, see PUSH-SETUP.md). Replace both values, then run just this line:
-- insert into public.push_config (id, function_url, secret) values (1, 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/push', 'THE-SAME-LONG-RANDOM-SECRET') on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret;
