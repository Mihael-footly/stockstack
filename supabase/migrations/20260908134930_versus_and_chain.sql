-- Head-to-head play. Boards are never synchronised cell by cell: each client
-- runs the same deterministic engine from the same seed, and the server
-- carries the match envelope and the attacks that pass between players.

create type public.match_status as enum ('waiting', 'active', 'finished', 'abandoned');
create type public.match_event_kind as enum ('attack', 'ready', 'topout', 'forfeit', 'heartbeat');

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  status public.match_status not null default 'waiting',
  seed text not null,
  rules_version integer not null,
  stock_pool text[] not null,
  started_at timestamptz,
  ended_at timestamptz,
  winner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index matches_status_idx on public.matches (status, created_at desc);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.game_sessions (id) on delete set null,
  slot smallint not null check (slot in (1, 2)),
  ready boolean not null default false,
  score bigint not null default 0,
  lines integer not null default 0,
  attacks_sent integer not null default 0,
  result text check (result in ('win', 'loss', 'draw')),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create unique index match_players_slot_idx on public.match_players (match_id, slot);

create table public.match_events (
  id bigserial primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.match_event_kind not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index match_events_match_idx on public.match_events (match_id, id);

alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_events enable row level security;

create policy matches_participant_read on public.matches
  for select to authenticated
  using (exists (
    select 1 from public.match_players mp
    where mp.match_id = matches.id and mp.user_id = (select auth.uid())
  ));

create policy match_players_participant_read on public.match_players
  for select to authenticated
  using (exists (
    select 1 from public.match_players mp
    where mp.match_id = match_players.match_id and mp.user_id = (select auth.uid())
  ));

create policy match_events_participant_read on public.match_events
  for select to authenticated
  using (exists (
    select 1 from public.match_players mp
    where mp.match_id = match_events.match_id and mp.user_id = (select auth.uid())
  ));

create policy match_events_self_insert on public.match_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.match_players mp
      where mp.match_id = match_events.match_id and mp.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Optional on-chain settlement.
--
-- Read the constraint on reward_pools before anything else here: an allocation
-- cannot exceed what has actually been funded. The game is complete without
-- any of this. What it does NOT do is turn a game stock unit into a share --
-- those two ledgers never meet, by construction.
-- ---------------------------------------------------------------------------

create type public.wallet_status as enum ('unverified', 'verified', 'revoked');
create type public.onchain_status as enum ('unconfigured', 'pending', 'submitted', 'confirmed', 'failed');

create table public.wallet_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  address text not null,
  network text not null,
  status public.wallet_status not null default 'unverified',
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, address, network)
);

create index wallet_connections_user_idx on public.wallet_connections (user_id);

create table public.reward_pools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  stock_id uuid references public.stock_catalog (id) on delete restrict,
  funded_units numeric not null default 0 check (funded_units >= 0),
  allocated_units numeric not null default 0 check (allocated_units >= 0),
  opens_at timestamptz,
  closes_at timestamptz,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint allocation_within_funding check (allocated_units <= funded_units)
);

create table public.onchain_reward_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pool_id uuid references public.reward_pools (id) on delete set null,
  wallet_connection_id uuid references public.wallet_connections (id) on delete set null,
  amount numeric not null check (amount > 0),
  -- 'unconfigured' is the honest default: no settlement backend is wired up,
  -- so nothing has been promised to anyone.
  status public.onchain_status not null default 'unconfigured',
  tx_hash text,
  network text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index onchain_tx_user_idx on public.onchain_reward_transactions (user_id, created_at desc);

create trigger onchain_tx_touch
  before update on public.onchain_reward_transactions
  for each row execute function public.touch_updated_at();

alter table public.wallet_connections enable row level security;
alter table public.reward_pools enable row level security;
alter table public.onchain_reward_transactions enable row level security;

create policy wallet_self_read on public.wallet_connections
  for select to authenticated using (user_id = (select auth.uid()));

create policy wallet_self_insert on public.wallet_connections
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy wallet_self_delete on public.wallet_connections
  for delete to authenticated using (user_id = (select auth.uid()));

create policy reward_pools_public_read on public.reward_pools
  for select using (is_active);

create policy onchain_tx_self_read on public.onchain_reward_transactions
  for select to authenticated using (user_id = (select auth.uid()));
