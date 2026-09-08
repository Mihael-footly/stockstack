-- Foundation: shared helpers, enums, and the profile row every other private
-- table hangs off.

create extension if not exists pgcrypto;

create type public.game_mode as enum ('solo', 'daily', 'versus');
create type public.session_status as enum ('active', 'submitted', 'abandoned', 'rejected');
create type public.validation_status as enum ('valid', 'suspicious', 'rejected');
create type public.stock_rarity as enum ('common', 'uncommon', 'rare', 'epic');

-- Reason codes for the portfolio ledger. A transaction always says why it
-- exists, so a balance can be explained rather than merely trusted.
create type public.ledger_reason as enum (
  'line_clear',
  'daily_bonus',
  'match_win_bonus',
  'admin_adjustment',
  'reward_claim'
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Profiles. `level` and `xp` live here because everything reads them, but the
-- client is never allowed to write them -- see the guard trigger below.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    constraint username_shape check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text,
  avatar_url text,
  level integer not null default 1 check (level >= 1),
  xp integer not null default 0 check (xp >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_username_idx on public.profiles (username);

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A player may rename themselves; they may not promote themselves.
create or replace function public.guard_profile_progression()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.level is distinct from old.level or new.xp is distinct from old.xp then
    raise exception 'level and xp are awarded by the server, not set by the client';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_progression
  before update on public.profiles
  for each row execute function public.guard_profile_progression();

-- Every new auth user gets a profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
begin
  base := lower(regexp_replace(split_part(coalesce(new.email, 'player'), '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base) < 3 then
    base := 'player';
  end if;
  base := left(base, 14);

  loop
    candidate := case when suffix = 0 then base else base || suffix::text end;
    exit when not exists (select 1 from public.profiles where username = candidate);
    suffix := suffix + 1;
    if suffix > 9999 then
      candidate := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data ->> 'full_name', candidate));

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy profiles_public_read on public.profiles
  for select using (true);

create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
