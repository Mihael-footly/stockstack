-- Game sessions and their results. A session is opened by the server before
-- play starts, which is what makes the seed, ruleset and start time facts
-- rather than client claims.

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Null for guests. Guests can play; they simply bank nothing.
  user_id uuid references public.profiles (id) on delete set null,
  mode public.game_mode not null,
  seed text not null,
  rules_version integer not null,
  -- The market the session was played against, frozen at start so a later
  -- catalog edit cannot rewrite what a past run was worth.
  stock_pool text[] not null,
  market_date date,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status public.session_status not null default 'active',
  client_info jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index game_sessions_user_idx on public.game_sessions (user_id, started_at desc);
create index game_sessions_active_idx on public.game_sessions (user_id, status) where status = 'active';

-- One daily attempt per player per day. A partial unique index is the whole
-- enforcement -- no application code can forget it.
create unique index game_sessions_one_daily_per_user
  on public.game_sessions (user_id, market_date)
  where mode = 'daily' and user_id is not null and status <> 'rejected';

create table public.game_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.game_sessions (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  mode public.game_mode not null,
  score bigint not null check (score >= 0),
  lines integer not null check (lines >= 0),
  level integer not null check (level >= 1),
  duration_ms integer not null check (duration_ms >= 0),
  max_combo integer not null default 0 check (max_combo >= 0),
  four_line_clears integer not null default 0 check (four_line_clears >= 0),
  perfect_clears integer not null default 0 check (perfect_clears >= 0),
  pieces_placed integer not null default 0 check (pieces_placed >= 0),
  stock_units_total integer not null default 0 check (stock_units_total >= 0),
  -- Ticker -> units, as awarded. Kept alongside the ledger so a result is
  -- self-describing even if a stock is later retired from the catalog.
  stock_units jsonb not null default '{}'::jsonb,
  validation_status public.validation_status not null default 'valid',
  validation_notes text,
  action_count integer not null default 0,
  action_log_hash text,
  xp_awarded integer not null default 0,
  market_date date,
  created_at timestamptz not null default now()
);

create index game_results_user_idx on public.game_results (user_id, created_at desc);
create index game_results_leaderboard_idx
  on public.game_results (mode, validation_status, score desc, created_at desc);
create index game_results_daily_idx
  on public.game_results (market_date, score desc)
  where mode = 'daily' and validation_status = 'valid';

alter table public.game_sessions enable row level security;
alter table public.game_results enable row level security;

-- Nobody writes these directly -- they are created and closed by the
-- security-definer functions.
create policy game_sessions_self_read on public.game_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy game_results_public_read on public.game_results
  for select using (validation_status = 'valid' or user_id = (select auth.uid()));
