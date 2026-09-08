-- The signed-in reward path, end to end, with a real authenticated JWT context.
--
-- The Playwright acceptance run plays as a guest, which deliberately banks
-- nothing — so the half a player cares most about ("my units were actually
-- saved") is only proven here. This creates its own user, plays a session as
-- that user, checks the ledger, and cleans up after itself.
--
-- This is the test that caught the progression guard blocking the server's own
-- XP award. Run it after any change to the reward path.
--
--   psql "$DATABASE_URL" -f supabase/tests/signed_in_path.sql
--
-- Every row it returns must have ok = true.

create or replace function pg_temp.probe_signed_in()
returns table (step text, observed text, ok boolean)
language plpgsql
as $$
declare
  v_user uuid := gen_random_uuid();
  v_session uuid;
  v_profile record;
  v_result record;
  v_before_xp integer;
  v_blocked boolean := false;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'probe-' || substr(v_user::text, 1, 8) || '@stockstack.local',
    crypt('pw', gen_salt('bf')), now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb
  );

  select * into v_profile from public.profiles where id = v_user;
  return query select 'profile auto-created',
    format('username=%s level=%s xp=%s', v_profile.username, v_profile.level, v_profile.xp),
    v_profile.id is not null and v_profile.level = 1 and v_profile.xp = 0;
  v_before_xp := v_profile.xp;

  -- From here, behave exactly as a browser client does.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  select id into v_session from public.start_game_session(
    'solo', 1, array['NVDA','AAPL','HOOD','META','TSLA','MSFT','AMZN'], null, '{}'::jsonb);
  return query select 'session opened as the player', v_session::text, v_session is not null;

  -- Backdate the start so a realistic duration passes the wall-clock check
  -- without the test having to sleep.
  perform set_config('role', 'postgres', true);
  update public.game_sessions set started_at = now() - interval '90 seconds' where id = v_session;
  perform set_config('role', 'authenticated', true);

  select * into v_result from public.submit_game_result(
    v_session, 24000, 42, 5, 78000, 6, 3, 1, 190,
    '{"NVDA": 64, "AAPL": 41, "HOOD": 22}'::jsonb, 620, 'probe-hash');

  return query select 'realistic run accepted',
    coalesce(v_result.validation_notes, v_result.validation_status::text),
    v_result.validation_status = 'valid';
  return query select 'units totalled', v_result.stock_units_total::text, v_result.stock_units_total = 127;
  return query select 'xp awarded on the result', v_result.xp_awarded::text, v_result.xp_awarded > 0;

  return query select 'balance rows written',
    (select count(*)::text from public.portfolio_balances where user_id = v_user),
    (select count(*) from public.portfolio_balances where user_id = v_user) = 3;
  return query select 'NVDA balance',
    (select units::text from public.portfolio_balances where user_id = v_user and ticker = 'NVDA'),
    (select units from public.portfolio_balances where user_id = v_user and ticker = 'NVDA') = 64;
  return query select 'balances equal the ledger',
    format('%s vs %s',
      (select coalesce(sum(units),0) from public.portfolio_balances where user_id = v_user),
      (select coalesce(sum(amount),0) from public.portfolio_transactions where user_id = v_user)),
    (select coalesce(sum(units),0) from public.portfolio_balances where user_id = v_user)
      = (select coalesce(sum(amount),0) from public.portfolio_transactions where user_id = v_user);
  return query select 'every unit cites its session',
    (select count(*)::text from public.portfolio_transactions where user_id = v_user and game_session_id = v_session),
    (select count(*) from public.portfolio_transactions where user_id = v_user and game_session_id = v_session) = 3;

  select * into v_profile from public.profiles where id = v_user;
  return query select 'progression advanced',
    format('level=%s xp=%s', v_profile.level, v_profile.xp),
    v_profile.xp > v_before_xp or v_profile.level > 1;
  return query select 'xp recorded in its own ledger',
    (select count(*)::text from public.player_xp_events where user_id = v_user),
    (select count(*) from public.player_xp_events where user_id = v_user) = 1;

  -- ...and a client still must not be able to promote itself.
  begin
    update public.profiles set level = 99, xp = 999999 where id = v_user;
  exception when others then
    v_blocked := true;
  end;
  return query select 'self-promotion still blocked',
    case when v_blocked then 'refused' else 'ALLOWED' end, v_blocked;

  perform set_config('role', 'postgres', true);
  delete from auth.users where id = v_user;
  return query select 'cleanup', 'test user removed', true;
end $$;

select * from pg_temp.probe_signed_in();
