/**
 * The hero's backdrop: a skyline of stacked blocks and chart columns.
 *
 * Built from the game's own vocabulary — piece silhouettes, a grid, rising
 * columns — and kept behind a heavy fade so it never competes with the
 * headline. Static SVG plus a couple of slow drifts; no canvas, so it costs
 * nothing next to the live board beside it.
 */
const COLUMNS = [
  { x: 2, h: 26, c: "#19F28A" },
  { x: 10, h: 44, c: "#43A5FF" },
  { x: 18, h: 34, c: "#19F28A" },
  { x: 26, h: 58, c: "#FFD84A" },
  { x: 34, h: 40, c: "#43A5FF" },
  { x: 42, h: 68, c: "#19F28A" },
  { x: 50, h: 50, c: "#43A5FF" },
  { x: 58, h: 76, c: "#19F28A" },
  { x: 66, h: 46, c: "#FF5C5C" },
  { x: 74, h: 62, c: "#43A5FF" },
  { x: 82, h: 88, c: "#19F28A" },
  { x: 90, h: 54, c: "#FFD84A" },
];

const FLOATERS = [
  { left: "8%", top: "18%", size: 26, rot: -14, delay: 0, color: "#19F28A", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { left: "78%", top: "12%", size: 22, rot: 12, delay: 1.4, color: "#43A5FF", cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  { left: "62%", top: "68%", size: 20, rot: 22, delay: 2.6, color: "#FFD84A", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { left: "16%", top: "72%", size: 18, rot: -8, delay: 3.4, color: "#C6F24E", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
];

export function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="bg-grid absolute inset-0 opacity-70" />

      {/* Chart towers along the floor. */}
      <svg
        className="absolute inset-x-0 bottom-0 h-[46%] w-full opacity-[0.5]"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {COLUMNS.map((c, i) => (
          <g key={i}>
            <rect x={c.x} y={100 - c.h} width={6} height={c.h} fill={c.c} opacity={0.1} rx={0.7} />
            {/* Individual blocks, so the towers read as stacks rather than bars. */}
            {Array.from({ length: Math.floor(c.h / 7) }, (_, k) => (
              <rect
                key={k}
                x={c.x}
                y={100 - (k + 1) * 7 + 0.9}
                width={6}
                height={5.4}
                fill={c.c}
                opacity={0.08 + k * 0.014}
                rx={0.7}
              />
            ))}
          </g>
        ))}
      </svg>

      {/* A rising trend line over the towers. */}
      <svg className="absolute inset-x-0 bottom-0 h-[46%] w-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points="0,86 10,72 18,78 28,54 36,62 46,38 54,46 64,26 74,34 84,14 92,22 100,8"
          fill="none"
          stroke="#19F28A"
          strokeWidth="0.7"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Drifting piece silhouettes. */}
      {FLOATERS.map((f, i) => {
        const w = Math.max(...f.cells.map((c) => c[0])) + 1;
        const h = Math.max(...f.cells.map((c) => c[1])) + 1;
        return (
          <div
            key={i}
            className="animate-float absolute"
            style={{
              left: f.left,
              top: f.top,
              ["--r" as string]: `${f.rot}deg`,
              ["--d" as string]: `${7 + i}s`,
              animationDelay: `${f.delay}s`,
            }}
          >
            <div
              className="grid gap-[3px]"
              style={{ gridTemplateColumns: `repeat(${w}, ${f.size}px)`, gridTemplateRows: `repeat(${h}, ${f.size}px)` }}
            >
              {Array.from({ length: w * h }, (_, k) => {
                const cx = k % w;
                const cy = Math.floor(k / w);
                const on = f.cells.some((c) => c[0] === cx && c[1] === cy);
                return (
                  <div
                    key={k}
                    style={{
                      background: on ? f.color : "transparent",
                      opacity: on ? 0.13 : 0,
                      borderRadius: 4,
                    }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Keep the type legible over all of it. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 30% 40%, rgba(4,9,15,0.5), rgba(4,9,15,0.9) 70%)" }}
      />
    </div>
  );
}
