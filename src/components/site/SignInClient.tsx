"use client";

import Link from "next/link";
import { useState } from "react";
import { SiteNav } from "./SiteNav";
import { MobileTabsSpacer } from "./MobileTabs";
import { getSupabaseBrowser, isSupabaseConfigured } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { track } from "@/lib/analytics";

/**
 * Sign in by email link.
 *
 * A magic link rather than a password: there is nothing here worth the risk of
 * storing one, and it removes a whole class of account-recovery problem from a
 * game people will sign into once.
 */
export function SignInClient() {
  const { profile, email, signOut } = useProfile();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const configured = isSupabaseConfigured();

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setState("error");
      setMessage("The backend is not configured, so sign-in is unavailable.");
      return;
    }
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: address.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setState("error");
      setMessage(error.message);
      return;
    }
    setState("sent");
    track("signed_in", { method: "magic_link" });
  };

  return (
    <div className="min-h-dvh">
      <SiteNav cta={false} />

      <main className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
        <span className="panel-label">Account</span>
        <h1 className="font-display mt-1.5 text-sm text-white">SIGN IN</h1>

        {profile ? (
          <div className="block-surface mt-6 p-6">
            <p className="text-sm text-[var(--color-muted)]">
              Signed in as <span className="font-extrabold text-white">@{profile.username}</span>
              {email ? ` (${email})` : ""}.
            </p>
            <div className="mt-5 flex gap-2">
              <Link href="/lobby" className="btn btn-primary flex-1 py-2.5 text-xs">
                Lobby
              </Link>
              <button
                className="btn btn-ghost flex-1 py-2.5 text-xs"
                onClick={() => {
                  void signOut();
                  track("signed_out");
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        ) : state === "sent" ? (
          <div className="block-surface mt-6 p-6">
            <div className="font-display text-sm text-[var(--color-gain)]">CHECK YOUR EMAIL</div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
              A sign-in link is on its way to <span className="font-bold text-white">{address}</span>.
              Open it on this device and you will land back in the lobby.
            </p>
            <button className="btn btn-ghost mt-5 w-full py-2.5 text-xs" onClick={() => setState("idle")}>
              Use a different address
            </button>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
              You do not need an account to play. Sign in to keep your stockpile, earn XP, enter the
              leaderboards, and take the Daily Run.
            </p>

            <form onSubmit={send} className="block-surface mt-6 p-6">
              <label htmlFor="email" className="panel-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 w-full  border border-[var(--color-line)] bg-[var(--color-void)] px-3.5 py-3 text-sm text-white outline-none transition-colors placeholder:text-[var(--color-faint)] focus:border-[var(--color-gain)]"
              />
              <button
                type="submit"
                disabled={state === "sending" || !configured}
                className="btn btn-primary mt-4 w-full py-3 text-xs"
              >
                {state === "sending" ? "Sending…" : "Send sign-in link"}
              </button>

              {state === "error" && (
                <p className="mt-3 text-[11px] font-bold text-[var(--color-loss)]">{message}</p>
              )}
              {!configured && (
                <p className="mt-3 text-[11px] font-bold text-[var(--color-loss)]">
                  Backend not configured — sign-in is unavailable in this environment.
                </p>
              )}
            </form>

            <Link href="/play" className="btn btn-ghost mt-3 w-full py-3 text-xs">
              Keep playing as a guest
            </Link>
          </>
        )}
      </main>
      <MobileTabsSpacer />
    </div>
  );
}
