-- Wallet accounts have no email, so the original derivation fell through to
-- "player", "player1", "player2" -- every Web3 sign-up racing for the same
-- name. An account authenticated by an address should be named after it.
--
-- The address is read from several likely places because Supabase's Web3
-- provider records it in the identity rather than in one fixed column, and a
-- username is not worth failing a sign-up over: anything unrecognised still
-- falls back to "player".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
  v_address text;
  v_display text;
begin
  v_address := coalesce(
    new.raw_user_meta_data ->> 'address',
    new.raw_user_meta_data ->> 'wallet_address',
    ''
  );

  if new.email is not null and new.email <> '' then
    base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  elsif v_address ~ '^0x[a-fA-F0-9]{40}$' then
    -- 0x1a2b3c4d: short enough to read, long enough to be distinct.
    base := lower(substr(v_address, 1, 10));
  else
    base := 'player';
  end if;

  if length(base) < 3 then
    base := 'player';
  end if;
  base := left(base, 14);

  loop
    candidate := case when suffix = 0 then base else base || suffix::text end;
    exit when not exists (select 1 from public.profiles where username = candidate);
    suffix := suffix + 1;
    if suffix > 9999 then
      candidate := left(base, 8) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
  end loop;

  if v_address ~ '^0x[a-fA-F0-9]{40}$' then
    v_display := substr(v_address, 1, 6) || '...' || right(v_address, 4);
  else
    v_display := candidate;
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data ->> 'full_name', v_display));

  return new;
end;
$$;

revoke all on function public.handle_new_user() from anon, authenticated, public;
