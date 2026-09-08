import Link from "next/link";
import { SiteNav } from "@/components/site/SiteNav";
import { MobileTabsSpacer } from "@/components/site/MobileTabs";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <SiteNav />
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <div className="font-display text-xs text-white">404</div>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Nothing stacked here.
        </p>
        <Link href="/" className="btn btn-primary mt-7 px-8 py-3 text-xs">
          Back to StockStack
        </Link>
      </main>
      <MobileTabsSpacer />
    </div>
  );
}
