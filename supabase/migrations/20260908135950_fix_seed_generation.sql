-- gen_random_bytes is a pgcrypto function, and on Supabase pgcrypto installs
-- into the `extensions` schema -- which this function's pinned search_path
-- deliberately excludes, so opening a solo session failed outright.
-- gen_random_uuid is in core Postgres (13+), always resolvable, no extension.
--
-- This revision also stops trusting the client's stock pool: for a daily run
-- the pool and the date both come from the server, and for solo the pool is
-- validated against the active catalog before it is accepted.
create or replace function public.start_game_session(
  p_mode public.game_mode,
  p_rules_version integer,
  p_stock_pool text[],
  p_market_date date default null,
  p_client_info jsonb default '{}'::jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_seed text;
  v_session public.game_sessions;
  v_recent integer;
  v_pool text[];
  v_date date;
  v_unknown integer;
begin
  if p_mode = 'daily' then
    if v_user is null then
      raise exception 'the daily run is for signed-in players';
    end if;
    -- The date is the server's, not the client's, so nobody can replay a
    -- favourable past market or reach into tomorrow.
    v_date := (now() at time zone 'utc')::date;
    perform public.ensure_daily_market(v_date);
    select stock_pool into v_pool from public.daily_markets where market_date = v_date;
    v_seed := 'daily-' || v_date::text;
  else
    v_date := null;
    select count(*) into v_unknown
    from unnest(coalesce(p_stock_pool, array[]::text[])) as t(ticker)
    where not exists (
      select 1 from public.stock_catalog c where c.ticker = t.ticker and c.is_active
    );

    if p_stock_pool is null
       or array_length(p_stock_pool, 1) is null
       or array_length(p_stock_pool, 1) < 3
       or array_length(p_stock_pool, 1) > 12
       or v_unknown > 0 then
      -- Anything unusable falls back to today's market rather than failing the
      -- player's click.
      v_pool := public.daily_stock_pool((now() at time zone 'utc')::date);
    else
      v_pool := p_stock_pool;
    end if;

    v_seed := substr(replace(gen_random_uuid()::text, '-', ''), 1, 18);
  end if;

  if v_pool is null or array_length(v_pool, 1) is null then
    raise exception 'no market is available for this session';
  end if;

  if v_user is not null then
    select count(*) into v_recent
    from public.game_sessions
    where user_id = v_user and started_at > now() - interval '1 minute';

    if v_recent >= 20 then
      raise exception 'too many sessions started; slow down';
    end if;

    update public.game_sessions
    set status = 'abandoned', ended_at = now()
    where user_id = v_user
      and status = 'active'
      and started_at < now() - interval '2 hours';
  end if;

  insert into public.game_sessions (
    user_id, mode, seed, rules_version, stock_pool, market_date, client_info
  )
  values (v_user, p_mode, v_seed, p_rules_version, v_pool, v_date, coalesce(p_client_info, '{}'::jsonb))
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.start_game_session(public.game_mode, integer, text[], date, jsonb) from public;
grant execute on function public.start_game_session(public.game_mode, integer, text[], date, jsonb) to anon, authenticated;
