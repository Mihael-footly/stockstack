import type { GameEngine } from "./GameEngine";
import type { EffectsManager } from "./EffectsManager";
import { PIECES, type PieceKind } from "./pieces";
import type { StockDef } from "./stocks";

/**
 * Canvas drawing.
 *
 * The one performance idea that matters here: a block face — bevel, inner
 * border, ticker text — is expensive to draw and identical every time, so each
 * stock's block is rendered once into an offscreen canvas and then blitted.
 * Two hundred `drawImage` calls a frame costs nothing; two hundred gradient
 * fills plus text layout does not hold 60fps on a laptop.
 *
 * The sprite cache is keyed by cell size and rebuilt only on resize.
 */

const THEME = {
  boardBg: "#060C15",
  gridLine: "rgba(67,165,255,0.075)",
  gridLineStrong: "rgba(67,165,255,0.14)",
  border: "rgba(67,165,255,0.35)",
  ghost: "rgba(255,255,255,0.07)",
  ghostLine: "rgba(255,255,255,0.3)",
  pumpGlow: "#19F28A",
  bullGlow: "#FFD84A",
} as const;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  cell = 0;
  private width = 0;
  private height = 0;
  private sprites = new Map<string, HTMLCanvasElement>();
  private spriteCell = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private engine: GameEngine,
    private effects: EffectsManager,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is unavailable in this browser.");
    this.ctx = ctx;
  }

  /** Size the backing store to the CSS box, accounting for device pixel ratio. */
  resize(cssWidth: number, cssHeight: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cell = Math.floor(
      Math.min(cssWidth / this.engine.cols, cssHeight / this.engine.visibleRows),
    );
    this.cell = Math.max(8, cell);
    this.width = this.cell * this.engine.cols;
    this.height = this.cell * this.engine.visibleRows;
    this.dpr = dpr;

    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.spriteCell !== this.cell) {
      this.sprites.clear();
      this.spriteCell = this.cell;
    }
  }

  get cssWidth(): number {
    return this.width;
  }
  get cssHeight(): number {
    return this.height;
  }

  // -------------------------------------------------------------------------
  // Block sprites
  // -------------------------------------------------------------------------

  private sprite(stock: StockDef, variant: "solid" | "bright"): HTMLCanvasElement {
    const key = `${stock.ticker}:${variant}:${this.cell}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;

    const s = this.cell;
    const c = document.createElement("canvas");
    c.width = s;
    c.height = s;
    const g = c.getContext("2d")!;

    // Square corners and flat faces. A block is a block: one lit edge, one
    // shaded edge, a hard outline, no gradient and no radius. This is what
    // makes the field read as a stack of physical pieces rather than a chart.
    const gap = Math.max(1, Math.round(s * 0.04));
    const size = s - gap;
    const bevel = Math.max(2, Math.round(s * 0.14));

    const face = variant === "bright" ? stock.light : stock.color;
    const lit = variant === "bright" ? "#FFFFFF" : stock.light;
    const shade = variant === "bright" ? stock.color : stock.dark;

    // Body
    g.fillStyle = face;
    g.fillRect(gap, gap, size - gap, size - gap);

    // Lit faces: top and left.
    g.fillStyle = lit;
    g.fillRect(gap, gap, size - gap, bevel);
    g.fillRect(gap, gap, bevel, size - gap);

    // Shaded faces: bottom and right, mitred so the corners meet cleanly.
    g.fillStyle = shade;
    g.fillRect(gap, size - bevel, size - gap, bevel);
    g.fillRect(size - bevel, gap, bevel, size - gap);

    // The mitre: two small triangles where lit meets shaded.
    g.fillStyle = face;
    g.beginPath();
    g.moveTo(gap, gap);
    g.lineTo(gap + bevel, gap + bevel);
    g.lineTo(size - bevel, gap + bevel);
    g.lineTo(size - gap, gap);
    g.closePath();
    g.fill();
    g.fillStyle = lit;
    g.globalAlpha = 0.5;
    g.fillRect(gap + bevel, gap + bevel, size - gap - bevel * 2, 1);
    g.globalAlpha = 1;

    // Hard outline, so neighbouring blocks of one stock stay countable.
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.lineWidth = 1;
    g.strokeRect(gap + 0.5, gap + 0.5, size - gap - 1, size - gap - 1);

    // Ticker. Skipped below the size where it would be mush rather than text.
    if (s >= 20) {
      const label = stock.ticker;
      let font = Math.round(s * (label.length > 4 ? 0.24 : 0.28));
      g.fillStyle = stock.ink;
      g.textAlign = "center";
      g.textBaseline = "middle";
      const setFont = (px: number) => {
        g.font = `800 ${px}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      };
      setFont(font);
      let guard = 0;
      while (g.measureText(label).width > (size - bevel * 2) * 0.94 && font > 6 && guard++ < 10) {
        font -= 1;
        setFont(font);
      }
      g.globalAlpha = 0.92;
      g.fillText(label, gap + (size - gap) / 2, gap + (size - gap) / 2 + font * 0.05);
      g.globalAlpha = 1;
    }

    this.sprites.set(key, c);
    return c;
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  draw(): void {
    const ctx = this.ctx;
    const e = this.engine;
    const s = this.cell;

    ctx.save();

    // Screen shake, applied to the whole board rather than individual pieces.
    if (this.effects.shake > 0.2) {
      const a = this.effects.shake;
      ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a);
    }

    ctx.fillStyle = THEME.boardBg;
    ctx.fillRect(-20, -20, this.width + 40, this.height + 40);

    this.drawEventBackdrop();
    this.drawGrid();

    // Everything from here is clipped to the playfield, so a piece sliding
    // down out of the hidden rows appears rather than pops.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();

    this.drawLockedBlocks();
    this.drawGhost();
    this.drawActivePiece();
    this.drawRowFlashes();
    this.drawParticles();
    this.drawFloatingText();

    ctx.restore();

    this.drawBorder();
    ctx.restore();
  }

  private drawEventBackdrop(): void {
    const ctx = this.ctx;
    const ev = this.engine.events;
    if (!ev.pumpActive && !ev.bullRunActive && this.effects.boardGlow <= 0.01) return;

    const color = ev.bullRunActive ? THEME.bullGlow : THEME.pumpGlow;
    const base = ev.bullRunActive ? 0.1 : ev.pumpActive ? 0.07 : 0;
    const alpha = Math.min(0.3, base + this.effects.boardGlow * 0.18);

    const grad = ctx.createLinearGradient(0, this.height, 0, 0);
    grad.addColorStop(0, hexAlpha(color, alpha));
    grad.addColorStop(1, hexAlpha(color, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    // A rising chart line behind the field during a pump — decorative, and
    // deliberately not derived from any real price series.
    if (ev.pumpActive || ev.bullRunActive) {
      const t = performance.now() / 1000;
      ctx.strokeStyle = hexAlpha(color, 0.16);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * this.width;
        const wave = Math.sin(i * 0.7 + t * 1.6) * this.height * 0.03;
        const y = this.height * 0.86 - (i / steps) * this.height * 0.5 + wave;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const s = this.cell;
    ctx.lineWidth = 1;

    ctx.strokeStyle = THEME.gridLine;
    ctx.beginPath();
    for (let x = 1; x < this.engine.cols; x++) {
      const px = Math.round(x * s) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.height);
    }
    for (let y = 1; y < this.engine.visibleRows; y++) {
      const py = Math.round(y * s) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(this.width, py);
    }
    ctx.stroke();

    // Every fourth row a shade stronger: it gives the well a rhythm to judge
    // heights against, which is most of what reading a stack quickly is.
    ctx.strokeStyle = THEME.gridLineStrong;
    ctx.beginPath();
    for (let y = 4; y < this.engine.visibleRows; y += 4) {
      const py = Math.round(y * s) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(this.width, py);
    }
    ctx.stroke();
  }

  private drawLockedBlocks(): void {
    const e = this.engine;
    const s = this.cell;
    const clearing = new Set<number>();
    for (const f of this.effects.flashes) clearing.add(f.row);

    for (let y = e.hiddenRows; y < e.rows; y++) {
      const sy = (y - e.hiddenRows) * s;
      for (let x = 0; x < e.cols; x++) {
        const stock = e.at(x, y);
        if (stock < 0) continue;
        const def = e.stocks[stock];
        if (!def) continue;
        this.ctx.drawImage(this.sprite(def, "solid"), x * s, sy, s, s);
      }
    }
  }

  private drawGhost(): void {
    const e = this.engine;
    const p = e.active;
    if (!p || e.phase !== "playing") return;
    const gy = e.ghostY();
    if (gy === p.y) return;

    const ctx = this.ctx;
    const s = this.cell;
    const cells = PIECES[p.kind][p.rot];
    const def = e.stocks[p.stock];
    ctx.save();
    for (const c of cells) {
      const x = (p.x + c[0]) * s;
      const y = (gy + c[1] - e.hiddenRows) * s;
      const pad = Math.max(2, Math.round(s * 0.1));
      // A hollow square in the piece's own colour: it says where the piece will
      // land and which stock is landing there, without competing with the stack.
      ctx.fillStyle = THEME.ghost;
      ctx.fillRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
      ctx.strokeStyle = def ? `${def.color}66` : THEME.ghostLine;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + pad + 1, y + pad + 1, s - pad * 2 - 2, s - pad * 2 - 2);
    }
    ctx.restore();
  }

  private drawActivePiece(): void {
    const e = this.engine;
    const p = e.active;
    if (!p) return;
    const def = e.stocks[p.stock];
    if (!def) return;
    const s = this.cell;
    const sprite = this.sprite(def, "bright");
    for (const c of PIECES[p.kind][p.rot]) {
      const x = (p.x + c[0]) * s;
      const y = (p.y + c[1] - e.hiddenRows) * s;
      this.ctx.drawImage(sprite, x, y, s, s);
    }
  }

  private drawRowFlashes(): void {
    const ctx = this.ctx;
    const s = this.cell;
    for (const f of this.effects.flashes) {
      const t = f.ageMs / f.lifeMs;
      const y = (f.row - this.engine.hiddenRows) * s;
      if (y < -s || y > this.height) continue;

      // A quick horizontal sweep, brightest at the start.
      const alpha = (1 - t) * 0.85 * f.intensity;
      const grad = ctx.createLinearGradient(0, 0, this.width, 0);
      grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.25})`);
      grad.addColorStop(Math.min(0.95, t * 1.3), `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, `rgba(255,255,255,${alpha * 0.25})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, this.width, s);
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx;
    const s = this.cell;
    for (const p of this.effects.particles) {
      const t = p.ageMs / p.lifeMs;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * s, (p.y - this.engine.hiddenRows) * s, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  private drawFloatingText(): void {
    const ctx = this.ctx;
    const s = this.cell;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const t of this.effects.texts) {
      const k = t.ageMs / t.lifeMs;
      const alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
      const scale = k < 0.15 ? 0.8 + (k / 0.15) * 0.25 : 1.02;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = `${t.weight} ${Math.round(t.size * scale)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(3,8,16,0.85)";
      const px = t.x * s;
      const py = (t.y - this.engine.hiddenRows) * s;
      ctx.strokeText(t.text, px, py);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, px, py);
    }
    ctx.globalAlpha = 1;
  }

  private drawBorder(): void {
    // The well: a recessed frame, dark on the top-left and lit on the
    // bottom-right, so the playfield reads as carved into the page rather
    // than drawn on it.
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, 0, 2, h);

    ctx.fillStyle = "rgba(67,165,255,0.22)";
    ctx.fillRect(0, h - 2, w, 2);
    ctx.fillRect(w - 2, 0, 2, h);

    ctx.strokeStyle = THEME.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  // -------------------------------------------------------------------------
  // Hold / next previews — drawn on their own small canvases.
  // -------------------------------------------------------------------------

  drawPreview(
    canvas: HTMLCanvasElement,
    entries: { kind: PieceKind; stock: number }[],
    cellSize: number,
  ): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rowH = cellSize * 3;
    const cssW = cellSize * 4.4;
    const cssH = Math.max(rowH, rowH * entries.length);

    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    entries.forEach((entry, i) => {
      const def = this.engine.stocks[entry.stock];
      if (!def) return;
      const cells = PIECES[entry.kind][0];
      const xs = cells.map((c) => c[0]);
      const ys = cells.map((c) => c[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const pw = (maxX - minX + 1) * cellSize;
      const ph = (maxY - minY + 1) * cellSize;
      const ox = (cssW - pw) / 2;
      const oy = i * rowH + (rowH - ph) / 2;

      // Previews use their own cell size, so build sprites at that size too.
      const prev = this.cell;
      this.cell = cellSize;
      const sprite = this.sprite(def, "solid");
      this.cell = prev;

      for (const c of cells) {
        ctx.drawImage(
          sprite,
          ox + (c[0] - minX) * cellSize,
          oy + (c[1] - minY) * cellSize,
          cellSize,
          cellSize,
        );
      }
    });
  }
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
