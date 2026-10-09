// Generates the app icons (SVG favicon + PNGs) from one geometry definition.
// No dependencies: shapes are rasterized with signed distance functions and
// encoded as PNG with node:zlib. Run with `npm run icons`; outputs are committed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const OUT = 'public/icons';

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

// Theme colors (see src/styles/tokens.css): violet glow fading into navy.
const GRADIENT: [number, string][] = [[0, '#7c3aed'], [0.55, '#1e1b4b'], [1, '#0b1030']];
const PANEL_FILL_ALPHA = 0.14;
const PANEL_STROKE_ALPHA = 0.35;

interface Variant {
  file: string;
  size: number;
  // Background corner radius as a fraction of the size; 0 = full-bleed square.
  cornerRadius: number;
  // Glass panel size as a fraction of the icon. Maskable icons keep it well inside
  // the central 80% safe zone so launcher masks never crop the symbol.
  panel: number;
}

const VARIANTS: Variant[] = [
  { file: 'icon-192.png', size: 192, cornerRadius: 0.225, panel: 0.62 },
  { file: 'icon-512.png', size: 512, cornerRadius: 0.225, panel: 0.62 },
  { file: 'icon-maskable-192.png', size: 192, cornerRadius: 0, panel: 0.5 },
  { file: 'icon-maskable-512.png', size: 512, cornerRadius: 0, panel: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, cornerRadius: 0, panel: 0.56 }, // iOS rounds it itself
];

// Geometry in unit coordinates (0..1), derived from the panel size.
function geometry(panel: number) {
  const p = (v: number) => 0.5 + v * panel; // panel-relative (-0.5..0.5) -> unit
  const arm = 0.24, head = 0.12, gap = 0.12;
  return {
    panel: { x: p(-0.5), y: p(-0.5), size: panel, radius: panel * 0.24, stroke: panel * 0.02 },
    stroke: panel * 0.085,
    // ⇄: an arrow pointing right above one pointing left.
    segments: [
      [p(-arm), p(-gap), p(arm), p(-gap)], [p(arm), p(-gap), p(arm - head), p(-gap - head)], [p(arm), p(-gap), p(arm - head), p(-gap + head)],
      [p(arm), p(gap), p(-arm), p(gap)], [p(-arm), p(gap), p(-arm + head), p(gap - head)], [p(-arm), p(gap), p(-arm + head), p(gap + head)],
    ] as [number, number, number, number][],
  };
}

// ---- SVG ----

function svg(v: Omit<Variant, 'file' | 'size'>): string {
  const g = geometry(v.panel);
  const r = (n: number) => +(n * 100).toFixed(3); // viewBox is 0..100
  const stops = GRADIENT.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
  const path = g.segments.map(([x1, y1, x2, y2]) => `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>` +
    `<rect width="100" height="100" rx="${r(v.cornerRadius)}" fill="url(#bg)"/>` +
    `<rect x="${r(g.panel.x)}" y="${r(g.panel.y)}" width="${r(g.panel.size)}" height="${r(g.panel.size)}" rx="${r(g.panel.radius)}" ` +
    `fill="#fff" fill-opacity="${PANEL_FILL_ALPHA}" stroke="#fff" stroke-opacity="${PANEL_STROKE_ALPHA}" stroke-width="${r(g.panel.stroke)}"/>` +
    `<path d="${path}" fill="none" stroke="#fff" stroke-width="${r(g.stroke)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>\n`;
}

// ---- Raster ----

function roundedRectDist(x: number, y: number, x0: number, y0: number, w: number, h: number, r: number): number {
  const qx = Math.abs(x - (x0 + w / 2)) - (w / 2 - r);
  const qy = Math.abs(y - (y0 + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function segmentDist(x: number, y: number, [x1, y1, x2, y2]: [number, number, number, number]): number {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function gradientAt(t: number): Rgb {
  for (let i = 1; i < GRADIENT.length; i++) {
    const [o0, c0] = GRADIENT[i - 1]!, [o1, c1] = GRADIENT[i]!;
    if (t <= o1) {
      const k = (t - o0) / (o1 - o0), a = hex(c0), b = hex(c1);
      return [0, 1, 2].map((j) => a[j]! + (b[j]! - a[j]!) * k) as Rgb;
    }
  }
  return hex(GRADIENT[GRADIENT.length - 1]![1]);
}

function render(v: Variant): Buffer {
  const { size } = v;
  const g = geometry(v.panel);
  // Distance (unit coords) -> pixel coverage, giving 1px anti-aliased edges.
  const cover = (d: number) => Math.max(0, Math.min(1, 0.5 - d * size));
  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size, y = (py + 0.5) / size;
      // Premultiplied RGBA, composited back to front with "over".
      let [r, gr, b] = gradientAt((x + y) / 2);
      let a = v.cornerRadius ? cover(roundedRectDist(x, y, 0, 0, 1, 1, v.cornerRadius)) : 1;
      r *= a; gr *= a; b *= a;

      const over = (alpha: number) => {
        r = 255 * alpha + r * (1 - alpha); gr = 255 * alpha + gr * (1 - alpha); b = 255 * alpha + b * (1 - alpha);
        a = alpha + a * (1 - alpha);
      };
      const panelDist = roundedRectDist(x, y, g.panel.x, g.panel.y, g.panel.size, g.panel.size, g.panel.radius);
      over(PANEL_FILL_ALPHA * cover(panelDist) * a);
      over(PANEL_STROKE_ALPHA * cover(Math.abs(panelDist) - g.panel.stroke / 2) * a);
      over(cover(Math.min(...g.segments.map((s) => segmentDist(x, y, s))) - g.stroke / 2) * a);

      const i = (py * size + px) * 4;
      // Un-premultiply for PNG.
      rgba[i] = a ? Math.round(r / a) : 0;
      rgba[i + 1] = a ? Math.round(gr / a) : 0;
      rgba[i + 2] = a ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, rgba);
}

function png(size: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/favicon.svg`, svg({ cornerRadius: 0.225, panel: 0.62 }));
for (const v of VARIANTS) writeFileSync(`${OUT}/${v.file}`, render(v));
console.log(`Wrote favicon.svg and ${VARIANTS.length} PNGs to ${OUT}/`);
