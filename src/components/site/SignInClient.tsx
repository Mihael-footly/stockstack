"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SiteNav } from "./SiteNav";
import { MobileTabsSpacer } from "./MobileTabs";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { discoverWallets, shortAddress, type DiscoveredWallet } from "@/lib/wallet";
import { track } from "@/lib/analytics";

type Mode = "signin" | "signup";
type Status = { kind: "idle" | "busy" | "error" | "done"; message?: string };

/**
 * Sign in.
 *
 * Two ways in, and nothing here needs an inbox:
 *
 *  - Email and password. Magic links were the original design, but they only
 *    work once mail is actually deliverable — on a fresh project that means a
 *    shared SMTP sender with a low rate limit, and a link that lands in spam
 *    is a dead end the player cannot debug.
 *  - A Web3 wallet, over Sign-In With Ethereum (EIP-4361). The wallet signs a
 *    message naming this site; Supabase verifies the signature and issues the
 *    session. No password, no email, no custodial anything.
 */
export function SignInClient() {
  const router = useRouter();
  const { profile, email: currentEmail, signOut, refresh } = useProfile();
  const configured = isSupabaseConfigured();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [walletChecked, setWalletChecked] = useState(false);
  const [walletStatus, setWalletStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    discoverWallets().then((found) => {
      setWallets(found);
      setWalletChecked(true);
    });
  }, []);

  // --- email and password ---------------------------------------------------
  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        setStatus({ kind: "error", message: "The backend is not configured, so sign-in is unavailable." });
        return;
      }
      if (password.length < 8) {
        setStatus({ kind: "error", message: "Passwords need at least 8 characters." });
        return;
      }

      setStatus({ kind: "busy" });

      const credentials = { email: email.trim(), password };
      const { data, error } =
        mode === "signup"
          ? await supabase.auth.signUp(credentials)
          : await supabase.auth.signInWithPassword(credentials);

      if (error) {
        setStatus({ kind: "error", message: humanise(error.message) });
        return;
      }

      // A project that requires email confirmation returns a user but no
      // session. Saying so beats leaving them on a spinner.
      if (!data.session) {
        setStatus({
          kind: "done",
          message: "Account created. Check your email to confirm it, then sign in.",
        });
        return;
      }

      track("signed_in", { method: mode === "signup" ? "password_signup" : "password" });
      await refresh();
      router.push("/lobby");
    },
    [mode, email, password, refresh, router],
  );

  // --- wallet ---------------------------------------------------------------
  const signInWithWallet = useCallback(
    async (wallet?: DiscoveredWallet) => {
      const supabase = getSupabaseBrowser();
      if (!supabase) {
        setWalletStatus({ kind: "error", message: "The backend is not configured." });
        return;
      }

      setWalletStatus({ kind: "busy" });
      try {
        const { error } = await supabase.auth.signInWithWeb3({
          chain: "ethereum",
          statement: "Sign in to StockStack. This proves you own this wallet — it authorises no transaction and moves no funds.",
          ...(wallet && wallet.info.uuid !== "legacy" ? { wallet: wallet.provider } : {}),
        } as Parameters<typeof supabase.auth.signInWithWeb3>[0]);

        if (error) {
          setWalletStatus({ kind: "error", message: humaniseWeb3(error.message) });
          return;
        }

        track("wallet_connected", { chain: "ethereum" });
        track("signed_in", { method: "web3" });
        await refresh();
        router.push("/lobby");
      } catch (err) {
        // A user closing the wallet dialog is a decision, not a failure.
        const message = err instanceof Error ? err.message : "Wallet sign-in failed.";
        setWalletStatus(
          /reject|denied|cancel/i.test(message)
            ? { kind: "idle" }
            : { kind: "error", message: humaniseWeb3(message) },
        );
      }
    },
    [refresh, router],
  );

  // --- already signed in ----------------------------------------------------
  if (profile) {
    return (
      <Shell>
        <div className="block-surface mt-6 p-6">
          <p className="text-sm text-[var(--color-muted)]">
            Signed in as <span className="font-extrabold text-white">@{profile.username}</span>
            {currentEmail ? ` (${currentEmail})` : ""}.
          </p>
          <div className="mt-5 flex gap-2">
            <Link href="/lobby" className="btn btn-primary flex-1 py-3 text-[10px]">
              Lobby
            </Link>
            <button
              className="btn btn-ghost flex-1 py-3 text-[10px]"
              onClick={() => {
                void signOut();
                track("signed_out");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted)]">
        You do not need an account to play. Sign in to keep your stockpile, earn XP, enter the
        leaderboards, and take the Daily Run.
      </p>

      {/* --- wallet ---------------------------------------------------- */}
      <div className="block-surface mt-6 p-5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 bg-[var(--color-grape)]" />
          <span className="panel-label">Wallet</span>
        </div>

        {!walletChecked ? (
          <p className="mt-3 text-[11px] font-semibold text-[var(--color-faint)]">Looking for a wallet…</p>
        ) : wallets.length === 0 ? (
          <p className="mt-3 text-[11px] leading-relaxed font-semibold text-[var(--color-faint)]">
            No Ethereum wallet found in this browser. Install one — MetaMask, Rainbow, Coinbase
            Wallet — and this option appears.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {wallets.map((w) => (
              <button
                key={w.info.uuid}
                onClick={() => signInWithWallet(w)}
                disabled={walletStatus.kind === "busy" || !configured}
                className="btn btn-ghost w-full justify-start gap-3 px-4 py-3 text-[10px]"
              >
                {w.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.info.icon} alt="" width={18} height={18} />
                ) : (
                  <span className="h-4 w-4 bg-[var(--color-grape)]" />
                )}
                {walletStatus.kind === "busy" ? "Check your wallet…" : `Sign in with ${w.info.name}`}
              </button>
            ))}
          </div>
        )}

        {walletStatus.kind === "error" && (
          <p className="mt-3 border-2 border-[var(--color-loss)] bg-[var(--color-loss)]/12 px-3 py-2.5 text-[11px] leading-relaxed font-bold text-[var(--color-loss)]">
            {walletStatus.message}
          </p>
        )}

        <p className="mt-3 border-t-2 border-[var(--color-line)] pt-3 text-[10px] leading-relaxed font-semibold text-[var(--color-faint)]">
          Signing proves you own the wallet. StockStack never asks for a transaction, never sees a
          private key, and cannot move anything you hold.
        </p>
      </div>

      {/* --- email and password ---------------------------------------- */}
      <div className="my-5 flex items-center gap-3">
        <span className="h-[2px] flex-1 bg-[var(--color-line)]" />
        <span className="panel-label">or</span>
        <span className="h-[2px] flex-1 bg-[var(--color-line)]" />
      </div>

      <form onSubmit={submit} className="block-surface p-5">
        <div className="mb-4 flex gap-1.5">
          {(["signin", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setStatus({ kind: "idle" });
              }}
              className={`tab inline-flex flex-1 justify-center ${mode === m ? "tab-active" : ""}`}
            >
              {m === "signin" ? "Sign in" : "Create"}
            </button>
          ))}
        </div>

        <label htmlFor="email" className="panel-label">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="block-inset mt-2 w-full px-3.5 py-3 text-sm text-white outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-gain)]"
        />

        <label htmlFor="password" className="panel-label mt-4 block">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className="block-inset mt-2 w-full px-3.5 py-3 text-sm text-white outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-gain)]"
        />

        <button
          type="submit"
          disabled={status.kind === "busy" || !configured}
          className="btn btn-primary mt-5 w-full py-3.5 text-[10px]"
        >
          {status.kind === "busy" ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        {status.kind === "error" && (
          <p className="mt-3 border-2 border-[var(--color-loss)] bg-[var(--color-loss)]/12 px-3 py-2.5 text-[11px] leading-relaxed font-bold text-[var(--color-loss)]">
            {status.message}
          </p>
        )}
        {status.kind === "done" && (
          <p className="mt-3 border-2 border-[var(--color-gain)] bg-[var(--color-gain)]/12 px-3 py-2.5 text-[11px] leading-relaxed font-bold text-[var(--color-gain)]">
            {status.message}
          </p>
        )}
        {!configured && (
          <p className="mt-3 text-[11px] font-bold text-[var(--color-loss)]">
            Backend not configured — sign-in is unavailable in this environment.
          </p>
        )}
      </form>

      <Link href="/play" className="btn btn-ghost mt-3 w-full py-3.5 text-[10px]">
        Keep playing as a guest
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SiteNav cta={false} />
      <main className="mx-auto flex max-w-md flex-col px-4 py-12 sm:px-6">
        <span className="panel-label">Account</span>
        <h1 className="font-display mt-2 text-xl text-white">SIGN IN</h1>
        {children}
      </main>
      <MobileTabsSpacer />
    </div>
  );
}

/** Supabase's auth errors are accurate but terse. */
function humanise(message: string): string {
  if (/Invalid login credentials/i.test(message)) {
    return "That email and password do not match an account. If you have not made one yet, switch to Create.";
  }
  if (/already registered|already exists/i.test(message)) {
    return "That email already has an account. Switch to Sign in.";
  }
  if (/Password should be/i.test(message)) return "Passwords need at least 8 characters.";
  if (/invalid/i.test(message) && /email/i.test(message)) {
    return "That email address was rejected. Try a different one.";
  }
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  return message;
}

function humaniseWeb3(message: string): string {
  if (/provider is not enabled|web3.*disabled|unsupported/i.test(message)) {
    return "Wallet sign-in is not switched on for this project yet. Enable the Web3 (Ethereum) provider in Supabase → Authentication → Providers.";
  }
  if (/redirect|domain|uri/i.test(message)) {
    return "This site's URL is not in the project's allowed redirect list, so the signed message was refused. Add it in Supabase → Authentication → URL Configuration.";
  }
  if (/signature/i.test(message)) return "The signature could not be verified. Try again.";
  return message;
}
