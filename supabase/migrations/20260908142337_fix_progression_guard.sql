-- The progression guard was blocking the server as well as the client.
--
-- It tested auth.role(), which reads the JWT's role claim -- and that claim
-- stays 'authenticated' inside a SECURITY DEFINER function, because the JWT
-- does not change when the effective database role does. So apply_xp, running
-- as the schema owner on the server's behalf, was refused by the very guard
-- meant to stop clients. In practice: no signed-in player could ever gain XP
-- or level up.
--
-- current_user is the right discriminator. Inside a SECURITY DEFINER function
-- it is the function's owner; on a PostgREST request it is anon or
-- authenticated. That distinguishes "the server is awarding" from "a client is
-- editing" without every server function having to remember a flag.
create or replace function public.guard_profile_progression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.level is distinct from old.level or new.xp is distinct from old.xp then
    raise exception 'level and xp are awarded by the server, not set by the client';
  end if;

  return new;
end;
$$;
