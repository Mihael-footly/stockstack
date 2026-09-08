-- The stock catalog and the daily market drawn from it.

create table public.stock_catalog (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique check (ticker ~ '^[A-Z]{1,6}$'),
  company_name text not null,
  icon_url text,
  game_color text not null,
  color_light text not null,
  color_dark text not null,
  color_ink text not null,
  -- Spawn frequency in the piece stream. Says nothing about the company; the
  -- UI repeats that wherever rarity is shown.
  rarity public.stock_rarity not null default 'common',
  is_active boolean not null default true,
  -- Populated only if and when a real tokenized asset is configured. Null
  -- means there is no on-chain counterpart, which is the default.
  onchain_asset_address text,
  network text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stock_catalog_active_idx on public.stock_catalog (is_active) where is_active;

create trigger stock_catalog_touch
  before update on public.stock_catalog
  for each row execute function public.touch_updated_at();

-- Daily markets. The pool and seed are derived from the date, so client and
-- server agree without a round trip.
create table public.daily_markets (
  id uuid primary key default gen_random_uuid(),
  market_date date not null unique,
  seed text not null,
  stock_pool text[] not null check (array_length(stock_pool, 1) between 3 and 12),
  rules jsonb not null default '{}'::jsonb,
  rules_version integer not null default 1,
  created_at timestamptz not null default now()
);

create index daily_markets_date_idx on public.daily_markets (market_date desc);

alter table public.stock_catalog enable row level security;
alter table public.daily_markets enable row level security;

create policy stock_catalog_public_read on public.stock_catalog
  for select using (true);

create policy daily_markets_public_read on public.daily_markets
  for select using (true);
