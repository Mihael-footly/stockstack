"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigation for phones.
 *
 * The header's links are hidden below `sm`, so without this a phone can reach
 * the lobby and nothing else. Fixed to the bottom, within thumb reach, and
 * sitting above the home indicator on iOS.
 */
interface Tab {
  href: string;
  label: string;
  icon: (props: { color: string }) => React.ReactElement;
  primary?: boolean;
}

const TABS: Tab[] = [
  { href: "/lobby", label: "Lobby", icon: LobbyIcon },
  { href: "/play", label: "Play", icon: PlayIcon, primary: true },
  { href: "/portfolio", label: "Portfolio", icon: PortfolioIcon },
  { href: "/leaderboard", label: "Ranks", icon: RanksIcon },
];

export function MobileTabs() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-[var(--color-line)] bg-[var(--color-deep)] sm:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Main"
    >
      <div className="flex items-stretch justify-around gap-1.5 px-2 py-2">
        {TABS.map((tab) => {
          const active = pathname === tab.href || (tab.href !== "/play" && pathname.startsWith(tab.href));
          const Icon = tab.icon;
          // On a filled tab the ink must read against the fill, not the page.
          const color = tab.primary ? "#04200F" : active ? "#04121F" : "var(--color-muted)";
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-w-[68px] flex-1 flex-col items-center gap-1.5 border-2 px-2 py-2 active:translate-y-[2px] ${
                tab.primary
                  ? "border-[#0B7A46] bg-[var(--color-gain)]"
                  : active
                    ? "border-[#14568F] bg-[var(--color-sky)]"
                    : "border-[var(--color-line)] bg-[var(--color-slate)]"
              }`}
              style={{
                boxShadow: tab.primary || active
                  ? "inset 3px 3px 0 rgba(255,255,255,0.45), inset -3px -3px 0 rgba(0,0,0,0.35)"
                  : "inset 3px 3px 0 rgba(120,175,235,0.14), inset -3px -3px 0 rgba(0,0,0,0.55)",
              }}
            >
              <Icon color={color} />
              <span className="font-display text-[7px] leading-none" style={{ color }}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Spacer so fixed tabs never cover the last row of a page. */
export function MobileTabsSpacer() {
  return <div className="h-20 sm:hidden" aria-hidden />;
}

function PlayIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 3.5v11l10-5.5-10-5.5Z" fill={color} />
    </svg>
  );
}

function LobbyIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2" y="2" width="6" height="6" rx="1.5" fill={color} />
      <rect x="10" y="2" width="6" height="6" rx="1.5" fill={color} opacity="0.55" />
      <rect x="2" y="10" width="6" height="6" rx="1.5" fill={color} opacity="0.55" />
      <rect x="10" y="10" width="6" height="6" rx="1.5" fill={color} />
    </svg>
  );
}

function PortfolioIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="2" y="10" width="3.4" height="6" rx="1" fill={color} opacity="0.55" />
      <rect x="7.3" y="6" width="3.4" height="10" rx="1" fill={color} />
      <rect x="12.6" y="2" width="3.4" height="14" rx="1" fill={color} opacity="0.8" />
    </svg>
  );
}

function RanksIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path d="M4 6h10l-1.4 4.2a2 2 0 0 1-1.9 1.3H7.3a2 2 0 0 1-1.9-1.3L4 6Z" fill={color} />
      <path d="M7 13.5h4v1.8H7z" fill={color} opacity="0.7" />
      <path d="M4 4.5h10" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
