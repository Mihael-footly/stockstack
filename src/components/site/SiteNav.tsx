"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MobileTabs } from "./MobileTabs";

/**
 * The logo: a two-by-two block cluster, cut from the same slabs as everything
 * else. Four squares in the four accent colours read as a piece without
 * committing to any one shape.
 */
export function Logo({ size = 10 }: { size?: number }) {
  const cell = (color: string) => (
    <span
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: `inset ${Math.max(1, size * 0.2)}px ${Math.max(1, size * 0.2)}px 0 rgba(255,255,255,0.45),
                    inset -${Math.max(1, size * 0.2)}px -${Math.max(1, size * 0.2)}px 0 rgba(0,0,0,0.4)`,
      }}
    />
  );
  return (
    <span className="grid shrink-0 grid-cols-2 gap-[2px]" aria-hidden>
      {cell("#19F28A")}
      {cell("#43A5FF")}
      {cell("#FFD84A")}
      {cell("#FF5C5C")}
    </span>
  );
}

const LINKS = [
  { href: "/lobby", label: "Lobby" },
  { href: "/portfolio", label: "Vault" },
  { href: "/leaderboard", label: "Ranks" },
];

export function SiteNav({ cta = true }: { cta?: boolean }) {
  const pathname = usePathname();

  return (
    <>
      {/*
        The tab bar below is a sibling of this header, never a child:
        `backdrop-filter` establishes a containing block, so a `fixed` element
        inside would anchor to the header rather than the viewport.
      */}
      <header className="sticky top-0 z-40 border-b-2 border-[var(--color-line)] bg-[var(--color-void)]/95 backdrop-blur-sm">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[13px] text-white sm:text-[15px]">STOCKSTACK</span>
          </Link>

          <div className="flex items-center gap-1.5">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`tab hidden sm:inline-flex ${active ? "tab-active" : ""}`}
                >
                  {l.label}
                </Link>
              );
            })}
            {cta && (
              <Link href="/play" className="btn btn-primary px-4 py-2.5 text-[10px] sm:px-5">
                Play
              </Link>
            )}
          </div>
        </nav>
      </header>

      {/*
        The header's links are hidden below `sm`, which on a phone would leave
        no route to the leaderboard or vault at all. This is that navigation.
      */}
      <MobileTabs />
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-[var(--color-line)] bg-[var(--color-deep)] px-4 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-md">
          <div className="flex items-center gap-2.5">
            <Logo size={9} />
            <span className="font-display text-[13px] text-white">STOCKSTACK</span>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-[var(--color-faint)]">
            StockStack is a game. Stock units are in-game collectibles earned by clearing lines —
            they are not shares, securities, or claims on any asset, and they carry no monetary
            value. Tickers and company names identify well-known public companies for flavour only;
            StockStack is not affiliated with, endorsed by, or sponsored by any of them. Nothing
            here is investment advice.
          </p>
        </div>
        <div className="flex gap-10">
          <div className="flex flex-col gap-2.5">
            <span className="panel-label">Play</span>
            <FooterLink href="/play">Solo</FooterLink>
            <FooterLink href="/play?mode=daily">Daily Run</FooterLink>
            <FooterLink href="/lobby">Lobby</FooterLink>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="panel-label">Progress</span>
            <FooterLink href="/portfolio">Vault</FooterLink>
            <FooterLink href="/leaderboard">Ranks</FooterLink>
            <FooterLink href="/signin">Sign in</FooterLink>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-bold text-[var(--color-muted)] hover:text-[var(--color-gain)]">
      {children}
    </Link>
  );
}
