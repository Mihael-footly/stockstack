# Database

Seventeen migrations, applied in order to the `stockstack` Supabase project.
They are numbered by the timestamp Supabase recorded, so this directory and
`supabase_migrations.schema_migrations` agree row for row.

The later files are not tidy-ups — each one closes something the tests found:

| Migration | What it fixes |
| --- | --- |
| `lock_down_internal_functions` | `revoke ... from public` does **not** remove Supabase's grants to `anon` and `authenticated`. `apply_xp` was reachable at `/rest/v1/rpc/apply_xp`, so any player could have awarded themselves unlimited XP. |
| `server_authoritative_daily_market` | `start_game_session` took the stock pool as an argument, so a client could name its own daily market. The pool is now derived in the database from the date. |
| `fix_seed_generation` | `gen_random_bytes` lives in Supabase's `extensions` schema, which the function's pinned `search_path` excludes. Swapped for core `gen_random_uuid`. |
| `add_piece_rate_guard` | Nothing related pieces to time, so a forged run could claim 68 placements in two seconds. |
| `fix_progression_guard` | The guard tested `auth.role()`, which stays `authenticated` inside a `SECURITY DEFINER` function — so it blocked the server's own XP award. **No signed-in player could level up.** It now tests `current_user`. |
| `username_for_wallet_accounts` | Wallet accounts have no email, so every Web3 sign-up raced for the username `player`. They are now named after the address. |
| `cash_rewards_and_payouts` | The vault: a score threshold credits cash from a pool that cannot be over-drawn (`credited_usd <= funded_usd`), plus payout addresses and requests. |

## Applying to a fresh project

```bash
supabase link --project-ref <ref>
supabase db push
```

## Testing

`tests/signed_in_path.sql` exercises the authenticated award path end to end —
profile creation, session, validated submission, balances, ledger, XP, and the
self-promotion guard — with a real JWT context. Run it with `psql` or paste it
into the SQL editor; it creates and removes its own user.
