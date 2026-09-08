-- Close two holes the database linter found.
--
-- 1. `revoke ... from public` does not remove the grants Supabase gives the
--    `anon` and `authenticated` roles on functions in the public schema. So
--    `apply_xp` was reachable at /rest/v1/rpc/apply_xp -- any signed-in player
--    could have awarded themselves arbitrary XP. It is an internal helper
--    called by submit_game_result (which, being SECURITY DEFINER, keeps the
--    rights it needs), so nothing outside the database should reach it.
--
-- 2. `ensure_daily_market` inserts the pool for a date. Exposed to clients,
--    somebody could pre-create tomorrow's market with a pool of their
--    choosing.
--
-- start_game_session and submit_game_result stay callable: they are the API,
-- and both authenticate the caller themselves before doing anything.

revoke all on function public.apply_xp(uuid, integer, text, uuid) from anon, authenticated, public;
revoke all on function public.handle_new_user() from anon, authenticated, public;

-- A function without a pinned search_path resolves unqualified names through
-- the caller's path, which for a SECURITY DEFINER trigger is a privilege
-- escalation route. None of these three need a search path at all.
alter function public.touch_updated_at() set search_path = '';
alter function public.guard_profile_progression() set search_path = '';
alter function public.xp_for_level(integer) set search_path = '';
