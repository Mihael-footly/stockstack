/**
 * STOCKSTACK, built out of the game's own blocks.
 *
 * Each letter is a 5x5 pixel glyph rendered as individual cells, so the
 * wordmark is literally made of the thing the game is about — and it picks up
 * the same lit/shaded bevel as every other block on the site. A font could
 * never do that, and a static image would not scale or theme.
 */

type Glyph = readonly string[];

// 5 wide, 7 tall. '#' is a block.
const FONT: Record<string, Glyph> = {
  S: ["#####", "#....", "#....", "#####", "....#", "....#", "#####"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  O: ["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"],
  C: ["#####", "#....", "#....", "#....", "#....", "#....", "#####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  A: ["#####", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
};

/** Piece colours, cycled per letter so the word reads as a row of tetrominoes. */
const COLORS = ["#19F28A", "#43A5FF", "#FFD84A", "#FF5C5C", "#9B8BFF", "#00D6C2", "#C6F24E"];

export function BlockWordmark({
  text = "STOCKSTACK",
  cell = 10,
  gap = 2,
  className = "",
  lines,
}: {
  text?: string;
  cell?: number;
  gap?: number;
  className?: string;
  /** Split the word across lines; defaults to one line. */
  lines?: string[];
}) {
  const rows = lines ?? [text];

  return (
    <div className={className} role="img" aria-label={text}>
      {rows.map((line, li) => (
        <div key={li} className="flex" style={{ gap: cell + gap, marginBottom: li < rows.length - 1 ? cell : 0 }}>
          {line.split("").map((ch, i) => {
            const glyph = FONT[ch.toUpperCase()];
            if (!glyph) return null;
            const color = COLORS[(i + li * 3) % COLORS.length];
            return (
              <div
                key={`${li}-${i}`}
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(5, ${cell}px)`,
                  gridTemplateRows: `repeat(7, ${cell}px)`,
                  gap,
                }}
              >
                {glyph.flatMap((row, y) =>
                  row.split("").map((c, x) => (
                    <span
                      key={`${x}-${y}`}
                      style={
                        c === "#"
                          ? {
                              background: color,
                              boxShadow: `inset ${cell * 0.22}px ${cell * 0.22}px 0 rgba(255,255,255,0.5),
                                          inset -${cell * 0.22}px -${cell * 0.22}px 0 rgba(0,0,0,0.42)`,
                            }
                          : undefined
                      }
                    />
                  )),
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
