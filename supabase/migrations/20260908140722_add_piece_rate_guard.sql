-- Adds a placement-rate ceiling.
--
-- Writing a realistic test run exposed the gap: the existing checks would have
-- accepted 68 pieces placed inside two and a half seconds, because nothing
-- related pieces to time. A very strong human sustains four or five placements
-- a second; twelve is far past anyone and still blocks the absurd.

create or replace function public.submit_game_result(
  p_session_id uuid,
  p_score bigint,
  p_lines integer,
  p_level integer,
  p_duration_ms integer,
  p_max_combo integer,
  p_four_line_clears integer,
  p_perfect_clears integer,
  p_pieces_placed integer,
  p_stock_units jsonb,
  p_action_count integer,
  p_action_log_hash text
)
returns public.game_results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.game_sessions;
  v_result public.game_results;
  v_status public.validation_status := 'valid';
  v_notes text[] := array[]::text[];
  v_units_total integer := 0;
  v_server_elapsed_ms bigint;
  v_max_score bigint;
  v_ticker text;
  v_amount integer;
  v_stock public.stock_catalog;
  v_xp integer := 0;
  v_actions_per_second numeric;
  v_pieces_per_second numeric;
begin
  select * into v_session from public.game_sessions where id = p_session_id for update;

  if v_session.id is null then
    raise exception 'unknown session';
  end if;

  if v_session.user_id is distinct from v_user then
    raise exception 'this session belongs to another player';
  end if;

  if v_session.status <> 'active' then
    raise exception 'this session has already been closed';
  end if;

  v_server_elapsed_ms := extract(epoch from (now() - v_session.started_at)) * 1000;

  if p_duration_ms > v_server_elapsed_ms + 5000 then
    v_status := 'rejected';
    v_notes := v_notes || format('claimed %sms of play in %sms of wall clock', p_duration_ms, v_server_elapsed_ms);
  end if;

  if p_lines > p_pieces_placed * 4 then
    v_status := 'rejected';
    v_notes := v_notes || format('%s lines from %s pieces is not reachable', p_lines, p_pieces_placed);
  end if;

  if p_four_line_clears * 4 > p_lines then
    v_status := 'rejected';
    v_notes := v_notes || 'more four-line clears than lines';
  end if;

  if p_level > greatest(1, p_lines / 10 + 1) then
    v_status := 'rejected';
    v_notes := v_notes || 'level ahead of lines cleared';
  end if;

  v_max_score := (p_lines::bigint * 1200 * greatest(p_level, 1))
               + (p_pieces_placed::bigint * 60)
               + (p_perfect_clears::bigint * 2800 * greatest(p_level, 1))
               + 10000;
  if p_score > v_max_score then
    v_status := 'rejected';
    v_notes := v_notes || format('score %s exceeds the ceiling %s for this run', p_score, v_max_score);
  end if;

  if p_duration_ms > 1000 then
    -- No human sustains thirty inputs a second across a whole game.
    v_actions_per_second := p_action_count::numeric / (p_duration_ms::numeric / 1000);
    if v_actions_per_second > 30 then
      v_status := 'rejected';
      v_notes := v_notes || format('%s actions per second', round(v_actions_per_second, 1));
    end if;

    -- Nor twelve placements a second.
    v_pieces_per_second := p_pieces_placed::numeric / (p_duration_ms::numeric / 1000);
    if v_pieces_per_second > 12 then
      v_status := 'rejected';
      v_notes := v_notes || format('%s pieces per second', round(v_pieces_per_second, 1));
    end if;
  end if;

  for v_ticker, v_amount in select key, value::integer from jsonb_each_text(coalesce(p_stock_units, '{}'::jsonb))
  loop
    if v_amount < 0 then
      v_status := 'rejected';
      v_notes := v_notes || 'negative unit award';
    end if;
    if not (v_ticker = any (v_session.stock_pool)) then
      v_status := 'rejected';
      v_notes := v_notes || format('%s was not in this session''s market', v_ticker);
    end if;
    v_units_total := v_units_total + greatest(v_amount, 0);
  end loop;

  if v_units_total > p_lines * 10 * 12 then
    v_status := 'rejected';
    v_notes := v_notes || format('%s units from %s lines exceeds the multiplier ceiling', v_units_total, p_lines);
  end if;

  update public.game_sessions
  set status = case when v_status = 'rejected' then 'rejected'::public.session_status else 'submitted'::public.session_status end,
      ended_at = now()
  where id = p_session_id;

  if v_status = 'valid' and v_user is not null then
    v_xp := 60 + p_lines * 12 + greatest(p_level - 1, 0) * 40
          + p_four_line_clears * 50 + p_perfect_clears * 120;
  end if;

  insert into public.game_results (
    session_id, user_id, mode, score, lines, level, duration_ms,
    max_combo, four_line_clears, perfect_clears, pieces_placed,
    stock_units_total, stock_units, validation_status, validation_notes,
    action_count, action_log_hash, xp_awarded, market_date
  )
  values (
    p_session_id, v_user, v_session.mode, greatest(p_score, 0), greatest(p_lines, 0), greatest(p_level, 1),
    greatest(p_duration_ms, 0), greatest(p_max_combo, 0), greatest(p_four_line_clears, 0),
    greatest(p_perfect_clears, 0), greatest(p_pieces_placed, 0),
    case when v_status = 'valid' then v_units_total else 0 end,
    case when v_status = 'valid' then coalesce(p_stock_units, '{}'::jsonb) else '{}'::jsonb end,
    v_status,
    case when array_length(v_notes, 1) is null then null else array_to_string(v_notes, '; ') end,
    greatest(p_action_count, 0), p_action_log_hash, v_xp, v_session.market_date
  )
  returning * into v_result;

  -- Guests keep their run on screen but bank nothing; there is no account to
  -- bank it into.
  if v_status <> 'valid' or v_user is null then
    return v_result;
  end if;

  for v_ticker, v_amount in select key, value::integer from jsonb_each_text(coalesce(p_stock_units, '{}'::jsonb))
  loop
    if v_amount <= 0 then
      continue;
    end if;

    select * into v_stock from public.stock_catalog where ticker = v_ticker and is_active;
    if v_stock.id is null then
      continue;
    end if;

    insert into public.portfolio_transactions (user_id, stock_id, ticker, amount, reason, game_session_id)
    values (v_user, v_stock.id, v_ticker, v_amount, 'line_clear', p_session_id);

    insert into public.portfolio_balances (user_id, stock_id, ticker, units, games_mined, best_run)
    values (v_user, v_stock.id, v_ticker, v_amount, 1, v_amount)
    on conflict (user_id, stock_id) do update
      set units = public.portfolio_balances.units + excluded.units,
          games_mined = public.portfolio_balances.games_mined + 1,
          best_run = greatest(public.portfolio_balances.best_run, excluded.best_run);
  end loop;

  perform public.apply_xp(v_user, v_xp, 'game_complete', p_session_id);

  return v_result;
end;
$$;

revoke all on function public.submit_game_result(uuid, bigint, integer, integer, integer, integer, integer, integer, integer, jsonb, integer, text) from public;
grant execute on function public.submit_game_result(uuid, bigint, integer, integer, integer, integer, integer, integer, integer, jsonb, integer, text) to anon, authenticated;
