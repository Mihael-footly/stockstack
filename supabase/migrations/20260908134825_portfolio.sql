-- The stock economy.
--
-- These are GAME STOCK UNITS: in-game collectibles earned by clearing lines.
-- They are not shares, not tokens, and not claims on anything. The on-chain
-- tables are a separate ledger so the two can never be read as one balance.

-- Append-only history. Every unit a player holds can be traced to the clear
-- that produced it -- a balance is a conclusion, never an assertion.
create table public.portfolio_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stock_id uuid not null references public.stock_catalog (id) on delete restrict,
  ticker text not null,
  amount integer not null check (amount <> 0),
  reason public.ledger_reason not null,
  game_session_id uuid references public.game_sessions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index portfolio_tx_user_idx on public.portfolio_transactions (user_id, created_at desc);
create index portfolio_tx_session_idx on public.portfolio_transactions (game_session_id);
create index portfolio_tx_user_stock_idx on public.portfolio_transactions (user_id, stock_id);

-- The materialised sum of the ledger above. Kept by the award function, never
-- written by a client.
create table public.portfolio_balances (
  user_id uuid not null references public.profiles (id) on delete cascade,
  stock_id uuid not null references public.stock_catalog (id) on delete restrict,
  ticker text not null,
  units bigint not null default 0 check (units >= 0),
  games_mined integer not null default 0 check (games_mined >= 0),
  best_run integer not null default 0 check (best_run >= 0),
  first_mined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, stock_id)
);

create index portfolio_balances_user_idx on public.portfolio_balances (user_id, units desc);

create trigger portfolio_balances_touch
  before update on public.portfolio_balances
  for each row execute function public.touch_updated_at();

alter table public.portfolio_transactions enable row level security;
alter table public.portfolio_balances enable row level security;

-- Read your own. There is deliberately no insert or update policy for either
-- table: POST /portfolio/add {"NVDA": 1000000} has nowhere to land.
create policy portfolio_tx_self_read on public.portfolio_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy portfolio_balances_self_read on public.portfolio_balances
  for select to authenticated
  using (user_id = (select auth.uid()));
