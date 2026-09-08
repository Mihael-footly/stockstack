"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowser, isSupabaseConfigured } from "./supabase/client";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  level: number;
  xp: number;
}

export interface AuthState {
  loading: boolean;
  /** Null means playing as a guest, which is a supported state, not an error. */
  profile: Profile | null;
  email: string | null;
  /** Set when the backend itself could not be reached. */
  error: string | null;
  configured: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** XP needed to leave a level. Mirrors xp_for_level() in the database. */
export function xpForLevel(level: number): number {
  return 800 + level * 400;
}

export function useProfile(): AuthState {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user ?? null;
      setEmail(user?.email ?? null);

      if (!user) {
        setProfile(null);
        setError(null);
        setLoading(false);
        return;
      }

      const { data, error: err } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, level, xp")
        .eq("id", user.id)
        .maybeSingle();

      if (err) setError(err.message);
      setProfile((data as Profile) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setEmail(null);
  }, []);

  return { loading, profile, email, error, configured, refresh: load, signOut };
}
