-- Experience and cosmetics.

-- The same shape as the portfolio: an append-only ledger, with the running
-- total materialised onto profiles.
create table public.player_xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount > 0),
  reason text not null,
  game_session_id uuid references public.game_sessions (id) on delete set null,
  created_at timestamptz not null default now()
);

create index player_xp_user_idx on public.player_xp_events (user_id, created_at desc);

-- XP needed to leave a given level. Mirrors XP.curve in src/game/config.ts;
-- both sides must agree or the progress bar will disagree with the server.
create or replace function public.xp_for_level(p_level integer)
returns integer
language sql
immutable
as $$
  select 800 + p_level * 400;
$$;

create or replace function public.apply_xp(p_user uuid, p_amount integer, p_reason text, p_session uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_xp integer;
  v_level integer;
  v_need integer;
begin
  if p_amount <= 0 then
    select level into v_level from public.profiles where id = p_user;
    return coalesce(v_level, 1);
  end if;

  insert into public.player_xp_events (user_id, amount, reason, game_session_id)
  values (p_user, p_amount, p_reason, p_session);

  select xp + p_amount, level into v_xp, v_level
  from public.profiles where id = p_user for update;

  if v_level is null then
    return 1;
  end if;

  loop
    v_need := public.xp_for_level(v_level);
    exit when v_xp < v_need;
    v_xp := v_xp - v_need;
    v_level := v_level + 1;
  end loop;

  update public.profiles set xp = v_xp, level = v_level where id = p_user;
  return v_level;
end;
$$;

-- Cosmetics: structure only for now. Nothing here touches gameplay.
create table public.cosmetics (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('board_skin', 'block_style', 'clear_effect', 'background', 'banner', 'trail')),
  unlock_level integer not null default 1 check (unlock_level >= 1),
  payload jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.player_cosmetics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  cosmetic_id uuid not null references public.cosmetics (id) on delete cascade,
  equipped boolean not null default false,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

alter table public.player_xp_events enable row level security;
alter table public.cosmetics enable row level security;
alter table public.player_cosmetics enable row level security;

create policy player_xp_self_read on public.player_xp_events
  for select to authenticated using (user_id = (select auth.uid()));

create policy cosmetics_public_read on public.cosmetics
  for select using (is_active);

create policy player_cosmetics_self_read on public.player_cosmetics
  for select to authenticated using (user_id = (select auth.uid()));

create policy player_cosmetics_self_update on public.player_cosmetics
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
