-- The daily market is derived here, not sent by the client.
--
-- The daily run only means anything if every player gets the same board, and
-- start_game_session previously took the pool as an argument -- so a client
-- could have named its own market. The pool is now a pure function of the
-- date, computed in the database, and the client uses whatever the session
-- comes back with.
--
-- The hash is md5 over (ticker, date): deterministic, evenly spread, and
-- entirely adequate for choosing seven tickers. Rarity tiers are guaranteed a
-- share so a day is never all-common or all-epic.
create or replace function public.daily_stock_pool(p_date date)
returns text[]
language sql
stable
set search_path = ''
as $$
  with ranked as (
    select
      ticker,
      rarity,
      ('x' || substr(md5(ticker || ':' || p_date::text), 1, 8))::bit(32)::bigint as h
    from public.stock_catalog
    where is_active
  ),
  tiered as (
    select ticker, rarity, h,
           row_number() over (partition by rarity order by h) as rn_in_tier
    from ranked
  ),
  picked as (
    select ticker, h, 0 as prio from tiered where rarity = 'common'   and rn_in_tier <= 2
    union all
    select ticker, h, 1 as prio from tiered where rarity = 'uncommon' and rn_in_tier <= 2
    union all
    select ticker, h, 2 as prio from tiered where rarity = 'rare'     and rn_in_tier <= 1
  ),
  filled as (
    select ticker, h, prio from picked
    union
    select t.ticker, t.h, 3 as prio
    from tiered t
    where t.ticker not in (select p.ticker from picked p)
  )
  select array(
    select ticker
    from (select ticker, prio, h from filled order by prio, h limit 7) s
    order by ticker
  );
$$;

grant execute on function public.daily_stock_pool(date) to anon, authenticated;

create or replace function public.ensure_daily_market(p_date date)
returns public.daily_markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.daily_markets;
begin
  select * into v_row from public.daily_markets where market_date = p_date;
  if v_row.id is not null then
    return v_row;
  end if;

  insert into public.daily_markets (market_date, seed, stock_pool, rules_version)
  values (p_date, 'daily-' || p_date::text, public.daily_stock_pool(p_date), 1)
  on conflict (market_date) do update set market_date = excluded.market_date
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.ensure_daily_market(date) to anon, authenticated;
-- The old three-argument form took the pool from the caller. Gone.
drop function if exists public.ensure_daily_market(date, text[], integer);

-- Today's market, for the lobby and the landing page.
create or replace function public.current_daily_market()
returns table (market_date date, seed text, stock_pool text[])
language sql
stable
set search_path = ''
as $$
  select
    (now() at time zone 'utc')::date,
    'daily-' || (now() at time zone 'utc')::date::text,
    public.daily_stock_pool((now() at time zone 'utc')::date);
$$;

grant execute on function public.current_daily_market() to anon, authenticated;
