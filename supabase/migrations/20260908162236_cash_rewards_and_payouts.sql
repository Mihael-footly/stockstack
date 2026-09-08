-- Cash rewards.
--
-- A run that passes validation and beats a score threshold credits a small
-- cash amount to the player's vault, from which they can request a payout to
-- an address they control.
--
-- The load-bearing rule is the constraint on reward_pool: credited_usd can
-- never exceed funded_usd. Money cannot be promised into existence here. If
-- the pool is empty, runs still validate and still bank stock units -- they
-- simply earn no cash, and the vault says so rather than showing a number
-- nobody can pay.

create type public.payout_status as enum ('pending', 'approved', 'sent', 'failed', 'cancelled');

-- Singleton. `funded_usd` is raised only by whoever actually set the money
-- aside; nothing in the application can raise it.
create table public.reward_pool (
  id boolean primary key default true check (id),
  funded_usd numeric(14, 4) not null default 0 check (funded_usd >= 0),
  credited_usd numeric(14, 4) not null default 0 check (credited_usd >= 0),
  paid_out_usd numeric(14, 4) not null default 0 check (paid_out_usd >= 0),
  updated_at timestamptz not null default now(),
  constraint credits_within_funding check (credited_usd <= funded_usd),
  constraint payouts_within_credits check (paid_out_usd <= credited_usd)
);

insert into public.reward_pool (id) values (true);

-- Singleton. The rules a run is measured against.
create table public.reward_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  min_score bigint not null default 2000 check (min_score >= 0),
  credit_usd numeric(10, 4) not null default 0.03 check (credit_usd >= 0),
  -- A ceiling per player per day, so one person cannot drain the pool.
  daily_cap_usd numeric(10, 4) not null default 0.30 check (daily_cap_usd >= 0),
  min_payout_usd numeric(10, 4) not null default 1.00 check (min_payout_usd >= 0),
  chain_label text not null default 'Robinhood Chain',
  updated_at timestamptz not null default now()
);

insert into public.reward_config (id) values (true);

-- Append-only. One credit per result, enforced by the unique key rather than
-- by remembering to check.
create table public.reward_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_result_id uuid not null unique references public.game_results (id) on delete cascade,
  amount_usd numeric(10, 4) not null check (amount_usd > 0),
  score bigint not null,
  created_at timestamptz not null default now()
);

create index reward_credits_user_idx on public.reward_credits (user_id, created_at desc);

-- The materialised vault. Written only by the trigger and the payout functions.
create table public.vault_balances (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  credited_usd numeric(12, 4) not null default 0 check (credited_usd >= 0),
  -- Held while a payout request is open, so the same balance cannot be
  -- requested twice.
  reserved_usd numeric(12, 4) not null default 0 check (reserved_usd >= 0),
  paid_out_usd numeric(12, 4) not null default 0 check (paid_out_usd >= 0),
  updated_at timestamptz not null default now(),
  constraint reserved_within_credits check (reserved_usd + paid_out_usd <= credited_usd)
);

-- One payout address per player.
create table public.payout_addresses (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  chain text not null default 'robinhood-chain',
  address text not null check (address ~ '^0x[a-fA-F0-9]{40}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_usd numeric(12, 4) not null check (amount_usd > 0),
  chain text not null,
  address text not null,
  status public.payout_status not null default 'pending',
  tx_hash text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payout_requests_user_idx on public.payout_requests (user_id, created_at desc);
create unique index payout_requests_one_open_per_user
  on public.payout_requests (user_id)
  where status in ('pending', 'approved');

create trigger vault_balances_touch before update on public.vault_balances
  for each row execute function public.touch_updated_at();
create trigger payout_addresses_touch before update on public.payout_addresses
  for each row execute function public.touch_updated_at();
create trigger payout_requests_touch before update on public.payout_requests
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Crediting
--
-- A trigger rather than a call inside submit_game_result: the credit is a
-- consequence of a valid result existing, so it belongs to the row, and there
-- is no path that inserts a result without considering it.
-- ---------------------------------------------------------------------------
create or replace function public.award_cash_reward()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.reward_config;
  pool public.reward_pool;
  v_today_total numeric(12, 4);
  v_amount numeric(10, 4);
begin
  if new.user_id is null or new.validation_status <> 'valid' then
    return new;
  end if;

  select * into cfg from public.reward_config where id;
  if not cfg.enabled or new.score < cfg.min_score then
    return new;
  end if;

  -- Lock the pool for the length of the transaction: two runs finishing at
  -- once must not both spend the last cent.
  select * into pool from public.reward_pool where id for update;
  if pool.funded_usd - pool.credited_usd < cfg.credit_usd then
    -- Nothing left in the pot. The run still counts; it simply pays no cash.
    return new;
  end if;

  select coalesce(sum(amount_usd), 0) into v_today_total
  from public.reward_credits
  where user_id = new.user_id and created_at >= date_trunc('day', now());

  if v_today_total + cfg.credit_usd > cfg.daily_cap_usd then
    return new;
  end if;

  v_amount := cfg.credit_usd;

  insert into public.reward_credits (user_id, game_result_id, amount_usd, score)
  values (new.user_id, new.id, v_amount, new.score)
  on conflict (game_result_id) do nothing;

  if not found then
    return new;
  end if;

  update public.reward_pool set credited_usd = credited_usd + v_amount, updated_at = now() where id;

  insert into public.vault_balances (user_id, credited_usd)
  values (new.user_id, v_amount)
  on conflict (user_id) do update
    set credited_usd = public.vault_balances.credited_usd + excluded.credited_usd;

  return new;
end;
$$;

create trigger game_results_award_cash
  after insert on public.game_results
  for each row execute function public.award_cash_reward();

-- ---------------------------------------------------------------------------
-- Payout address and requests
-- ---------------------------------------------------------------------------
create or replace function public.set_payout_address(p_address text, p_chain text default 'robinhood-chain')
returns public.payout_addresses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.payout_addresses;
begin
  if v_user is null then
    raise exception 'sign in to set a payout address';
  end if;
  if p_address !~ '^0x[a-fA-F0-9]{40}$' then
    raise exception 'that is not a valid address: it should be 0x followed by 40 hex characters';
  end if;

  insert into public.payout_addresses (user_id, chain, address)
  values (v_user, coalesce(p_chain, 'robinhood-chain'), p_address)
  on conflict (user_id) do update
    set address = excluded.address, chain = excluded.chain
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.request_payout()
returns public.payout_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  cfg public.reward_config;
  v_vault public.vault_balances;
  v_addr public.payout_addresses;
  v_available numeric(12, 4);
  v_req public.payout_requests;
begin
  if v_user is null then
    raise exception 'sign in to request a payout';
  end if;

  select * into cfg from public.reward_config where id;
  select * into v_addr from public.payout_addresses where user_id = v_user;
  if v_addr.user_id is null then
    raise exception 'add a payout address first';
  end if;

  select * into v_vault from public.vault_balances where user_id = v_user for update;
  v_available := coalesce(v_vault.credited_usd, 0) - coalesce(v_vault.reserved_usd, 0) - coalesce(v_vault.paid_out_usd, 0);

  if v_available < cfg.min_payout_usd then
    raise exception 'you need at least %s to request a payout; you have %s',
      to_char(cfg.min_payout_usd, 'FM999990.00'), to_char(v_available, 'FM999990.00');
  end if;

  if exists (select 1 from public.payout_requests
             where user_id = v_user and status in ('pending', 'approved')) then
    raise exception 'you already have a payout in progress';
  end if;

  -- Reserve the balance so it cannot be requested twice while this one is open.
  update public.vault_balances
  set reserved_usd = reserved_usd + v_available
  where user_id = v_user;

  insert into public.payout_requests (user_id, amount_usd, chain, address)
  values (v_user, v_available, v_addr.chain, v_addr.address)
  returning * into v_req;

  return v_req;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: read your own, write nothing directly.
-- ---------------------------------------------------------------------------
alter table public.reward_pool enable row level security;
alter table public.reward_config enable row level security;
alter table public.reward_credits enable row level security;
alter table public.vault_balances enable row level security;
alter table public.payout_addresses enable row level security;
alter table public.payout_requests enable row level security;

-- The rules and the pot are public: a player is entitled to know what a run is
-- worth and whether the pool can actually pay.
create policy reward_config_public_read on public.reward_config for select using (true);
create policy reward_pool_public_read on public.reward_pool for select using (true);

create policy reward_credits_self_read on public.reward_credits
  for select to authenticated using (user_id = (select auth.uid()));
create policy vault_self_read on public.vault_balances
  for select to authenticated using (user_id = (select auth.uid()));
create policy payout_addresses_self_read on public.payout_addresses
  for select to authenticated using (user_id = (select auth.uid()));
create policy payout_requests_self_read on public.payout_requests
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on function public.award_cash_reward() from anon, authenticated, public;
grant execute on function public.set_payout_address(text, text) to authenticated;
grant execute on function public.request_payout() to authenticated;
