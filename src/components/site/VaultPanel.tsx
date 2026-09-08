"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { shortAddress } from "@/lib/wallet";

interface RewardConfig {
  enabled: boolean;
  min_score: number;
  credit_usd: number;
  daily_cap_usd: number;
  min_payout_usd: number;
  chain_label: string;
}

interface Pool {
  funded_usd: number;
  credited_usd: number;
}

interface Vault {
  credited_usd: number;
  reserved_usd: number;
  paid_out_usd: number;
}

interface PayoutRequest {
  id: string;
  amount_usd: number;
  address: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The cash side of the vault.
 *
 * Two things this must never do: show a balance the pool cannot cover, and
 * imply a payout has been sent when nothing has moved. Both are handled by
 * reading the pool's real funding state and by naming the status of a request
 * exactly.
 */
export function VaultPanel({ signedIn }: { signedIn: boolean }) {
  const [config, setConfig] = useState<RewardConfig | null>(null);
  const [pool, setPool] = useState<Pool | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [request, setRequest] = useState<PayoutRequest | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;

    const [cfg, pl] = await Promise.all([
      supabase.from("reward_config").select("*").maybeSingle(),
      supabase.from("reward_pool").select("funded_usd, credited_usd").maybeSingle(),
    ]);
    if (cfg.data) setConfig(cfg.data as RewardConfig);
    if (pl.data) setPool(pl.data as Pool);

    if (!signedIn) return;

    const [vb, ad, rq] = await Promise.all([
      supabase.from("vault_balances").select("credited_usd, reserved_usd, paid_out_usd").maybeSingle(),
      supabase.from("payout_addresses").select("address, chain").maybeSingle(),
      supabase
        .from("payout_requests")
        .select("id, amount_usd, address, status, tx_hash, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setVault((vb.data as Vault) ?? { credited_usd: 0, reserved_usd: 0, paid_out_usd: 0 });
    setAddress((ad.data as { address: string } | null)?.address ?? null);
    setRequest((rq.data as PayoutRequest) ?? null);
    if (ad.data) setDraft((ad.data as { address: string }).address);
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAddress = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(draft.trim())) {
      setNote({ kind: "err", text: "That is not a valid address — it should be 0x followed by 40 hex characters." });
      return;
    }
    setBusy(true);
    setNote(null);
    const { error } = await supabase.rpc("set_payout_address", {
      p_address: draft.trim(),
      p_chain: "robinhood-chain",
    });
    setBusy(false);
    if (error) {
      setNote({ kind: "err", text: error.message });
      return;
    }
    setNote({ kind: "ok", text: "Payout address saved." });
    void load();
  }, [draft, load]);

  const claim = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setBusy(true);
    setNote(null);
    const { error } = await supabase.rpc("request_payout");
    setBusy(false);
    if (error) {
      setNote({ kind: "err", text: error.message });
      return;
    }
    setNote({ kind: "ok", text: "Payout requested. It is queued for the next settlement run." });
    void load();
  }, [load]);

  if (!config) return null;

  const poolRemaining = pool ? Math.max(0, pool.funded_usd - pool.credited_usd) : 0;
  const poolLive = config.enabled && poolRemaining >= config.credit_usd;
  const available = vault
    ? Math.max(0, vault.credited_usd - vault.reserved_usd - vault.paid_out_usd)
    : 0;
  const canClaim = signedIn && Boolean(address) && available >= config.min_payout_usd && !request?.status.match(/pending|approved/);

  return (
    <div className="block-surface mt-4 p-5">
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 bg-[var(--color-gold)]" />
        <span className="panel-label">Cash rewards</span>
      </div>

      {/* --- what a run is worth ------------------------------------ */}
      <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
        Score over <span className="tabular font-bold text-white">{config.min_score.toLocaleString()}</span> in a
        validated run and your vault is credited{" "}
        <span className="tabular font-bold text-[var(--color-gold)]">{usd(config.credit_usd)}</span>, up to{" "}
        {usd(config.daily_cap_usd)} a day.
      </p>

      {/* --- the pot, stated honestly ------------------------------- */}
      <div className={`mt-4 border-2 px-3 py-2.5 ${poolLive ? "border-[var(--color-gain)]" : "border-[var(--color-gold)]"}`}>
        {poolLive ? (
          <>
            <div className="font-display text-[9px] text-[var(--color-gain)]">REWARD POOL FUNDED</div>
            <div className="tabular mt-1.5 text-[11px] text-[var(--color-muted)]">
              {usd(poolRemaining)} remaining of {usd(pool!.funded_usd)}
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-[9px] text-[var(--color-gold)]">
              {config.enabled ? "REWARD POOL EMPTY" : "CASH REWARDS PAUSED"}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed font-semibold text-[var(--color-muted)]">
              Runs still bank stock units and still count on the leaderboard — they just earn no cash
              until the pool is funded. Nothing is credited that cannot be paid.
            </p>
          </>
        )}
      </div>

      {!signedIn ? (
        <p className="mt-4 text-[11px] font-semibold text-[var(--color-faint)]">
          Sign in to collect cash rewards.
        </p>
      ) : (
        <>
          {/* --- balance ------------------------------------------- */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Figure label="Available" value={usd(available)} accent="var(--color-gold)" />
            <Figure label="Reserved" value={usd(vault?.reserved_usd ?? 0)} />
            <Figure label="Paid out" value={usd(vault?.paid_out_usd ?? 0)} />
          </div>

          {/* --- address ------------------------------------------- */}
          <div className="mt-5">
            <label htmlFor="payout" className="panel-label">
              {config.chain_label} address
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="payout"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="0x…"
                spellCheck={false}
                className="block-inset tabular min-w-0 flex-1 px-3 py-2.5 text-[11px] text-white outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-gain)]"
              />
              <button onClick={saveAddress} disabled={busy} className="btn btn-ghost shrink-0 px-4 py-2.5 text-[9px]">
                Save
              </button>
            </div>
            {address && (
              <p className="tabular mt-2 text-[10px] font-bold text-[var(--color-gain)]">
                Saved: {shortAddress(address)}
              </p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
              Check this carefully. A payout sent to the wrong address cannot be recovered.
            </p>
          </div>

          {/* --- claim --------------------------------------------- */}
          <button
            onClick={claim}
            disabled={!canClaim || busy}
            className="btn btn-gold mt-4 w-full py-3 text-[10px]"
          >
            {busy ? "Working…" : `Request payout (min ${usd(config.min_payout_usd)})`}
          </button>

          {available < config.min_payout_usd && (
            <p className="mt-2 text-[10px] font-semibold text-[var(--color-faint)]">
              {usd(config.min_payout_usd - available)} more to reach the minimum payout.
            </p>
          )}

          {request && (
            <div className="block-inset mt-3 px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="panel-label">Last request</span>
                <span
                  className="font-display text-[7px]"
                  style={{ color: request.status === "sent" ? "var(--color-gain)" : "var(--color-gold)" }}
                >
                  {request.status.toUpperCase()}
                </span>
              </div>
              <div className="tabular mt-1.5 text-[11px] text-white">
                {usd(Number(request.amount_usd))} → {shortAddress(request.address)}
              </div>
              {request.tx_hash && (
                <div className="tabular mt-1 text-[10px] break-all text-[var(--color-muted)]">{request.tx_hash}</div>
              )}
            </div>
          )}

          {note && (
            <p
              className={`mt-3 border-2 px-3 py-2.5 text-[11px] leading-relaxed font-bold ${
                note.kind === "ok"
                  ? "border-[var(--color-gain)] bg-[var(--color-gain)]/12 text-[var(--color-gain)]"
                  : "border-[var(--color-loss)] bg-[var(--color-loss)]/12 text-[var(--color-loss)]"
              }`}
            >
              {note.text}
            </p>
          )}
        </>
      )}

      {/* --- what a request actually does --------------------------- */}
      <p className="mt-4 border-t-2 border-[var(--color-line)] pt-3 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
        A payout request is queued, not sent. No treasury signer is connected to this deployment, so
        nothing moves on-chain automatically — a request records the amount and the address, and is
        settled by the operator. Requests stay <span className="text-[var(--color-gold)]">PENDING</span> until
        they are, and the amount is held in your vault meanwhile.
      </p>
    </div>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="block-inset px-3 py-2">
      <div className="panel-label">{label}</div>
      <div className="tabular mt-0.5 text-sm" style={{ color: accent ?? "#fff" }}>
        {value}
      </div>
    </div>
  );
}
