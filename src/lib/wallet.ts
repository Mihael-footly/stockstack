"use client";

/**
 * Ethereum wallet discovery.
 *
 * Uses EIP-6963, where wallets announce themselves on an event rather than
 * racing to own `window.ethereum`. With several extensions installed that
 * single global belongs to whichever loaded last, so asking the user which
 * wallet they meant is the only way to be right. `window.ethereum` remains the
 * fallback for wallets that have not adopted the standard.
 */

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface DiscoveredWallet {
  info: WalletInfo;
  provider: unknown;
}

interface AnnounceEvent extends Event {
  detail: DiscoveredWallet;
}

/**
 * Collects announced wallets. Resolves after a short window — the event is
 * fire-and-forget, so there is nothing to await on directly.
 */
export function discoverWallets(timeoutMs = 350): Promise<DiscoveredWallet[]> {
  if (typeof window === "undefined") return Promise.resolve([]);

  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredWallet>();

    const onAnnounce = (event: Event) => {
      const detail = (event as AnnounceEvent).detail;
      if (detail?.info?.uuid) found.set(detail.info.uuid, detail);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);

      // Nothing announced, but a legacy provider is present.
      if (found.size === 0 && hasLegacyProvider()) {
        found.set("legacy", {
          info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" },
          provider: (window as unknown as { ethereum: unknown }).ethereum,
        });
      }

      resolve([...found.values()]);
    }, timeoutMs);
  });
}

export function hasLegacyProvider(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
}

/** Shortens an address for display: 0x1234…9abc. */
export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
