/**
 * Geometry for the app-shell spider-web background.
 * The webs are drawn in one 1600x900 frame with preserveAspectRatio "slice".
 */
export const VIEWBOX = '0 0 1600 900';
export const ASPECT = 'xMidYMid slice';

/** The hub of the big top-right web. */
const HUB = { x: 1420, y: 200 };

/** Small deterministic random generator, so the web looks the same on every load. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** One orb web: radial spokes plus sagging capture rings. Returns two SVG path strings. */
export function orbWeb(cx: number, cy: number, radius: number, spokes: number, rings: number, seed: number) {
  const rand = rng(seed);
  const angles = Array.from({ length: spokes }, (_, i) => (i / spokes) * Math.PI * 2 + (rand() - 0.5) * 0.22);

  // Spokes run past the outer ring, like the anchor threads of a real web.
  const spokePath = angles
    .map((a) => {
      const len = radius * (1.25 + rand() * 0.5);
      return `M${f(cx)} ${f(cy)}L${f(cx + Math.cos(a) * len)} ${f(cy + Math.sin(a) * len)}`;
    })
    .join('');

  let ringPath = '';
  for (let k = 1; k <= rings; k++) {
    const r = radius * Math.pow(k / rings, 0.85);
    const pts = angles.map((a) => {
      const rr = r * (0.94 + rand() * 0.12);
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    });
    ringPath += `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      // The thread between two spokes sags slightly towards the hub.
      const sag = 0.9 + rand() * 0.04;
      const mx = cx + ((x1 + x2) / 2 - cx) * sag;
      const my = cy + ((y1 + y2) / 2 - cy) * sag;
      ringPath += `Q${f(mx)} ${f(my)} ${f(x2)} ${f(y2)}`;
    }
  }
  return { spokes: spokePath, rings: ringPath };
}

/** The webs in the background, from most to least visible. */
export const WEBS = [
  { ...orbWeb(HUB.x, HUB.y, 330, 18, 15, 7), opacity: 0.30 },
  { ...orbWeb(205, 650, 270, 16, 12, 21), opacity: 0.30 },
  { ...orbWeb(610, -20, 170, 13, 9, 43), opacity: 0.10 },
];

/** Loose single strands drifting across the page. */
export const STRANDS = [
  'M0 250Q140 420 270 560',
  'M90 900Q330 700 620 540',
  'M260 0Q300 210 210 420',
  'M1600 560Q1500 720 1330 900',
  'M940 0Q1060 120 1180 150',
];
