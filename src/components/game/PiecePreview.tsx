"use client";

import { memo } from "react";
import { PIECES, type PieceKind } from "@/game/pieces";
import type { StockDef } from "@/game/stocks";

/**
 * A small rendering of an upcoming piece.
 *
 * Drawn with DOM elements rather than canvas: it changes only when the queue
 * does, so there is nothing to gain from a second drawing surface, and a grid
 * of divs is far easier to lay out against the surrounding panel.
 */
export const PiecePreview = memo(function PiecePreview({
  kind,
  stock,
  size = 13,
  showTicker = true,
  dim = false,
}: {
  kind: PieceKind;
  stock: StockDef | undefined;
  size?: number;
  showTicker?: boolean;
  dim?: boolean;
}) {
  const cells = PIECES[kind][0];
  const xs = cells.map((c) => c[0]);
  const ys = cells.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const color = stock?.color ?? "#8AA0BC";
  const light = stock?.light ?? "#C3D0DE";
  const dark = stock?.dark ?? "#3A4A5E";

  return (
    <div className="flex items-center gap-2.5" style={{ opacity: dim ? 0.4 : 1 }}>
      <div
        className="grid shrink-0"
        style={{
          gridTemplateColumns: `repeat(${w}, ${size}px)`,
          gridTemplateRows: `repeat(${h}, ${size}px)`,
          width: w * size,
          height: h * size,
        }}
      >
        {Array.from({ length: w * h }, (_, i) => {
          const cx = (i % w) + minX;
          const cy = Math.floor(i / w) + minY;
          const filled = cells.some((c) => c[0] === cx && c[1] === cy);
          if (!filled) return <div key={i} />;
          // The same hard bevel the board draws, so a piece in the queue looks
          // like the piece that will land.
          const bev = Math.max(2, Math.round(size * 0.22));
          return (
            <div
              key={i}
              style={{
                background: color,
                boxShadow: `inset ${bev}px ${bev}px 0 ${light}, inset -${bev}px -${bev}px 0 ${dark}`,
                outline: "1px solid rgba(0,0,0,0.55)",
                outlineOffset: -1,
                margin: 0.5,
              }}
            />
          );
        })}
      </div>
      {showTicker && stock && (
        <span className="font-display text-[8px]" style={{ color: stock.color }}>
          {stock.ticker}
        </span>
      )}
    </div>
  );
});
