-- Leaderboards as views over game_results rather than a separate scores table.
-- A second copy of a score is a second thing that can be wrong, and there is
-- no way to write to a view that the results table has not already accepted.
--
-- security_invoker keeps the caller's RLS in force, so only results marked
-- valid are ever visible.

create or replace view public.leaderboard_entries
with (security_invoker = on) as
  select
    r.id,
    r.user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.level as player_level,
    r.mode,
    r.score,
    r.lines,
    r.level,
    r.max_combo,
    r.four_line_clears,
    r.perfect_clears,
    r.stock_units_total,
    r.duration_ms,
    r.market_date,
    r.created_at
  from public.game_results r
  join public.profiles p on p.id = r.user_id
  where r.validation_status = 'valid'
    and r.user_id is not null;

-- A player's single best run, so one person cannot occupy a whole board.
create or replace view public.leaderboard_all_time
with (security_invoker = on) as
  select distinct on (user_id) *
  from public.leaderboard_entries
  where mode <> 'versus'
  order by user_id, score desc, created_at asc;

create or replace view public.leaderboard_today
with (security_invoker = on) as
  select distinct on (user_id) *
  from public.leaderboard_entries
  where mode <> 'versus'
    and created_at >= date_trunc('day', now())
  order by user_id, score desc, created_at asc;

create or replace view public.leaderboard_week
with (security_invoker = on) as
  select distinct on (user_id) *
  from public.leaderboard_entries
  where mode <> 'versus'
    and created_at >= date_trunc('week', now())
  order by user_id, score desc, created_at asc;

-- The daily run allows one attempt, so no de-duplication is needed here.
create or replace view public.leaderboard_daily
with (security_invoker = on) as
  select *
  from public.leaderboard_entries
  where mode = 'daily';

-- Public player summary. Aggregates are computed rather than stored so they
-- cannot drift from the results they describe.
create or replace view public.player_stats
with (security_invoker = on) as
  select
    p.id as user_id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.level,
    p.xp,
    p.created_at,
    coalesce(count(r.id), 0) as total_games,
    coalesce(max(r.score), 0) as best_score,
    coalesce(sum(r.lines), 0) as total_lines,
    coalesce(max(r.max_combo), 0) as best_combo,
    coalesce(sum(r.four_line_clears), 0) as total_quads,
    coalesce(sum(r.perfect_clears), 0) as total_perfect_clears,
    coalesce(sum(r.stock_units_total), 0) as total_units_mined
  from public.profiles p
  left join public.game_results r
    on r.user_id = p.id and r.validation_status = 'valid'
  group by p.id;
