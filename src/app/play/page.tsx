import { GameScreen } from "@/components/game/GameScreen";
import type { GameMode } from "@/game/types";

export const metadata = { title: "Play — StockStack" };

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const resolved: GameMode = mode === "daily" ? "daily" : "solo";
  return <GameScreen mode={resolved} />;
}
