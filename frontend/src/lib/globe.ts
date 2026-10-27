// Port of the reference UI's canvas code: full-screen intro globe + ambient
// world-map wind background + coastline loading. The drawing math, polygon
// data, captions and timings are unchanged from the reference file; only DOM
// access goes through the elements passed in, and each starter returns a
// cleanup function for React unmount.

const RAD = Math.PI / 180;
const EMERALD = '#10B981';

/* ---------- Coarse world polygons (lon,lat) for globe + map ---------- */
const PG: number[][][] = [
  [-168, 66, -156, 71, -125, 70, -95, 72, -80, 69, -65, 62, -56, 52, -66, 44, -76, 35, -81, 25, -84, 30, -97, 27, -97, 19, -88, 16, -83, 10, -78, 8, -85, 10, -92, 14, -105, 20, -117, 32, -124, 40, -124, 48, -135, 58, -152, 60, -165, 60],
  [-55, 60, -45, 60, -20, 70, -20, 82, -60, 82, -72, 78, -55, 68],
  [-78, 8, -60, 10, -50, 0, -35, -6, -39, -15, -48, -26, -58, -38, -65, -45, -68, -55, -74, -50, -72, -30, -70, -18, -81, -5],
  [-10, 36, -9, 43, -1, 46, 4, 52, 8, 55, 10, 58, 5, 62, 15, 69, 30, 71, 60, 69, 80, 73, 105, 78, 140, 72, 180, 68, 180, 64, 160, 60, 155, 52, 141, 52, 135, 43, 129, 35, 122, 30, 120, 22, 108, 18, 105, 10, 100, 8, 103, 1, 98, 16, 92, 22, 80, 14, 77, 8, 73, 20, 67, 25, 57, 25, 59, 22, 52, 16, 43, 13, 35, 28, 34, 31, 36, 36, 28, 37, 24, 38, 20, 40, 15, 38, 12, 42, 8, 44, 3, 43, -2, 37],
  [-17, 21, -6, 35, 10, 37, 32, 31, 43, 12, 51, 11, 40, -5, 40, -15, 33, -26, 20, -35, 12, -18, 9, -1, 9, 4, -8, 4, -17, 14],
  [114, -22, 130, -12, 142, -11, 153, -27, 146, -39, 135, -34, 115, -34],
  [-5, 50, 1, 51, 2, 53, -2, 56, -2, 58, -5, 58.5, -6, 56, -3, 54, -5, 52],
  [-10, 52, -6, 52, -6, 55, -10, 54],
  [130, 31, 140, 36, 142, 44, 140, 41, 133, 34],
  [95, 5, 106, -6, 120, -8, 105, -3],
].map((a) =>
  a.reduce<number[][]>((r, v, i) => {
    if (i % 2) r[r.length - 1].push(v);
    else r.push([v]);
    return r;
  }, []),
);

function inP(x: number, y: number, p: number[][]): boolean {
  let o = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) o = !o;
  }
  return o;
}

/* ---------- Real coastlines (Natural Earth via world-atlas) ----------
   Fetched at runtime from jsDelivr (same CDN as ECharts). If the fetch fails,
   the coarse polygons above are used as an outline fallback so nothing breaks. */
const LAND_URL_110 = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const LAND_URL_50 = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-50m.json';

interface TopoGeometry {
  type: string;
  arcs?: number[][] | number[][][];
  geometries?: TopoGeometry[];
}
interface Topo {
  transform?: { scale: number[]; translate: number[] };
  arcs: number[][][];
  objects: Record<string, TopoGeometry>;
}

function topoRings(topo: Topo): number[][][] {
  const tf = topo.transform;
  const sc = tf ? tf.scale : [1, 1];
  const tr = tf ? tf.translate : [0, 0];
  const arcs = topo.arcs.map((a) => {
    let x = 0;
    let y = 0;
    return a.map((p) => {
      if (tf) {
        x += p[0];
        y += p[1];
        return [x * sc[0] + tr[0], y * sc[1] + tr[1]];
      }
      return [p[0], p[1]];
    });
  });
  const arc = (i: number) => (i < 0 ? arcs[~i].slice().reverse() : arcs[i]);
  const ring = (ids: number[]) => {
    let r: number[][] = [];
    ids.forEach((i) => {
      const a = arc(i);
      r = r.concat(r.length ? a.slice(1) : a);
    });
    return r;
  };
  const out: number[][][] = [];
  Object.keys(topo.objects).forEach((k) => {
    (function geom(g: TopoGeometry) {
      if (g.type === 'GeometryCollection') g.geometries?.forEach(geom);
      else if (g.type === 'Polygon')
        (g.arcs as number[][] | undefined)?.forEach((ids) => out.push(ring(ids)));
      else if (g.type === 'MultiPolygon')
        (g.arcs as number[][][] | undefined)?.forEach((poly) =>
          poly.forEach((ids) => out.push(ring(ids))),
        );
    })(topo.objects[k]);
  });
  return out;
}

interface Ring {
  hl: boolean;
  // Each point: [lonDeg, latDeg, breakBefore, lonRad, latRad]
  p: number[][];
}

function mkRings(rings: number[][][]): Ring[] {
  return rings
    .filter((r) => r.length > 2 && r.some((p) => p[1] > -60)) // drop Antarctica
    .map((r) => ({
      hl: inP(-2, 54, r) || inP(-8, 53.3, r),
      p: r.map((q, i) => {
        const seam = i > 0 && Math.abs(q[0]) >= 179.99 && Math.abs(r[i - 1][0]) >= 179.99;
        return [q[0], q[1], seam ? 1 : 0, q[0] * RAD, q[1] * RAD];
      }),
    }));
}

let LAND_G = mkRings(PG);
let LAND_B = LAND_G; // fallback until real data arrives

function fetchLand(u: string): Promise<Ring[]> {
  return fetch(u)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(topoRings)
    .then(mkRings);
}

const bgRedraws = new Set<() => void>();
const landReady = fetchLand(LAND_URL_110)
  .then((r) => {
    if (r.length > 20) {
      LAND_G = LAND_B = r;
    }
    /* then upgrade the background map to the sharper 50m coastline */
    fetchLand(LAND_URL_50)
      .then((r2) => {
        if (r2.length > 100) {
          LAND_B = r2;
          bgRedraws.forEach((fn) => fn());
        }
      })
      .catch(() => {});
  })
  .catch(() => {});

function landRGB(dark: boolean): string {
  return dark ? '244,244,245' : '24,24,27';
}

function fit(c: HTMLCanvasElement): { x: CanvasRenderingContext2D; w: number; h: number } {
  const d = window.devicePixelRatio || 1;
  const w = c.clientWidth || window.innerWidth;
  const h = c.clientHeight || window.innerHeight;
  c.width = w * d;
  c.height = h * d;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  x.setTransform(d, 0, 0, d, 0, 0);
  return { x, w, h };
}

/* ---------- Intro globe ---------- */
function ease(a: number): number {
  return a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
}

const INTRO_SEC = 3; /* total intro length in seconds (was 5.7) */
const TS = 5.7 / INTRO_SEC; /* time-scale applied to the original timeline */

export interface IntroHandle {
  skip: () => void;
  dispose: () => void;
}

export function startIntro(opts: {
  intro: HTMLElement;
  canvas: HTMLCanvasElement;
  cap: HTMLElement;
  skipBtn: HTMLElement;
  isDark: () => boolean;
  onDone: () => void;
}): IntroHandle {
  const { intro, canvas, cap, skipBtn, isDark, onDone } = opts;
  let t0 = 0;
  let introDone = false;
  let started = false;
  let raf = 0;
  let fallbackTimer = 0;
  const caps: [number, string][] = [
    [0, 'Connecting to Elexon BMRS'],
    [1.2, 'Reading wind actuals, FUELHH'],
    [2.2, 'Reading forecasts, WINDFOR'],
    [3.2, 'Locking on Great Britain'],
  ];

  function introLoop(now: number) {
    if (introDone) return;
    try {
      introFrame(now);
    } catch {
      // Never let a canvas/coastline failure brick the page: reveal it.
      document.body.classList.add('on');
      introDone = true;
      onDone();
    }
  }

  function introFrame(now: number) {
    const T = Math.max(0, (now - t0) / 1000) * TS;
    const { x, w: W, h: H } = fit(canvas);
    const RGB = landRGB(isDark());
    const e = ease(Math.min(1, Math.max(0, (T - 2.8) / 2.4)));
    const base = -120 + Math.min(T, 2.8) * 36;
    const L0 = (base + (-2.5 - base) * e) * RAD;
    const P0 = (18 + 36 * e) * RAD;
    const R = Math.min(W, H) * 0.3 * (1 + e * e * e * 17);
    x.clearRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    x.fillStyle = isDark() ? '#0A0A0A' : '#FFFFFF';
    x.beginPath();
    x.arc(cx, cy, R, 0, 7);
    x.fill();
    x.strokeStyle = 'rgba(16,185,129,.3)';
    x.lineWidth = 1;
    x.beginPath();
    x.arc(cx, cy, R, 0, 7);
    x.stroke();
    const sP = Math.sin(P0);
    const cP = Math.cos(P0);
    const B = [new Path2D(), new Path2D(), new Path2D()];
    const HL = new Path2D();
    LAND_G.forEach((r) => {
      let pen = false;
      let last: Path2D | null = null;
      let px = 0;
      let py = 0;
      for (let i = 0; i < r.p.length; i++) {
        const q = r.p[i];
        const l = q[3];
        const p = q[4];
        const dl = l - L0;
        const cp = Math.cos(p);
        const cs = sP * Math.sin(p) + cP * cp * Math.cos(dl);
        if (cs < 0.02) {
          pen = false;
          continue;
        }
        const X = cx + R * cp * Math.sin(dl);
        const Y = cy - R * (cP * Math.sin(p) - sP * cp * Math.cos(dl));
        const path = r.hl ? HL : B[cs < 0.25 ? 0 : cs < 0.6 ? 1 : 2];
        if (pen && !q[2]) {
          if (path !== last) path.moveTo(px, py);
          path.lineTo(X, Y);
        } else path.moveTo(X, Y);
        pen = true;
        last = path;
        px = X;
        py = Y;
      }
    });
    x.lineWidth = 1.1;
    x.lineJoin = 'round';
    [0.14, 0.32, 0.55].forEach((a, i) => {
      x.strokeStyle = 'rgba(' + RGB + ',' + a + ')';
      x.stroke(B[i]);
    });
    x.lineWidth = 1.8;
    x.strokeStyle = 'rgba(16,185,129,.95)';
    x.stroke(HL);
    const ci = (caps.filter((a) => T >= a[0]).pop() || caps[0])[1];
    if (cap.textContent !== ci) cap.textContent = ci;
    if (T > 4.7) intro.style.opacity = String(Math.max(0, 1 - (T - 4.7) / 0.9));
    if (T > 4.3) document.body.classList.add('on');
    if (T > 5.7) {
      introDone = true;
      onDone();
      return;
    }
    raf = requestAnimationFrame(introLoop);
  }

  function start() {
    if (started) return;
    started = true;
    t0 = performance.now();
    raf = requestAnimationFrame(introLoop);
  }

  function skip() {
    start();
    t0 = performance.now() - 4400 / TS;
  }

  /* start once the coastline is loaded (max 1.2 s wait, then use the fallback shapes) */
  Promise.race([landReady, new Promise((res) => setTimeout(res, 1200))]).then(start);
  skipBtn.addEventListener('click', skip);
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) skip();
  fallbackTimer = window.setTimeout(() => document.body.classList.add('on'), 5500);

  return {
    skip,
    dispose() {
      introDone = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(fallbackTimer);
      skipBtn.removeEventListener('click', skip);
    },
  };
}

/* ---------- World-map wind background ---------- */
const FARMS: [string, number, number][] = [
  ['Hornsea', 1.8, 53.9],
  ['Dogger Bank', 2.4, 54.9],
  ['Moray East', -2.8, 58.2],
  ['Whitelee', -4.3, 55.7],
  ['London Array', 1.4, 51.6],
  ['Walney', -3.5, 54],
];

export function startBackground(
  canvas: HTMLCanvasElement,
  isDark: () => boolean,
): () => void {
  let bx: CanvasRenderingContext2D | null = null;
  let off: HTMLCanvasElement | null = null;
  let S = 0;
  let OX = 0;
  let OY = 0;
  let raf = 0;
  let disposed = false;
  let pts: { x: number; y: number }[] = [];

  function setupBg() {
    const { x, w: W, h: H } = fit(canvas);
    bx = x;
    S = Math.max(W / 360, H / 140) * 1.55;
    OX = W * 0.56 + 2 * S;
    OY = H * 0.36 + 54 * S;
    off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const o = off.getContext('2d') as CanvasRenderingContext2D;
    const RGB = landRGB(isDark());
    const N = new Path2D();
    const HL = new Path2D();
    LAND_B.forEach((r) => {
      const path = r.hl ? HL : N;
      let pen = false;
      for (let i = 0; i < r.p.length; i++) {
        const q = r.p[i];
        const X = OX + q[0] * S;
        const Y = OY - q[1] * S;
        if (pen && !q[2]) path.lineTo(X, Y);
        else path.moveTo(X, Y);
        pen = true;
      }
    });
    o.lineJoin = 'round';
    o.lineWidth = 1;
    o.strokeStyle = 'rgba(' + RGB + ',.24)';
    o.stroke(N);
    o.lineWidth = 1.6;
    o.strokeStyle = 'rgba(16,185,129,.85)';
    o.stroke(HL);
    if (!pts.length)
      pts = Array.from({ length: 170 }, () => ({ x: Math.random() * W, y: Math.random() * H }));
  }

  function mp(lo: number, la: number): [number, number] {
    return [OX + lo * S, OY - la * S];
  }

  function loopBg(t: number) {
    if (disposed || !bx) return;
    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;
    bx.clearRect(0, 0, W, H);
    if (off) bx.drawImage(off, 0, 0, W, H);
    if (!matchMedia('(prefers-reduced-motion:reduce)').matches) {
      bx.lineWidth = 1;
      bx.strokeStyle = 'rgba(16,185,129,.28)';
      pts.forEach((p) => {
        const vx = 1.4 + Math.sin(p.y * 0.012 + t * 0.0004) * 0.9;
        const vy = Math.cos(p.x * 0.009 + t * 0.0003) * 0.6;
        bx?.beginPath();
        bx?.moveTo(p.x, p.y);
        bx?.lineTo(p.x - vx * 7, p.y - vy * 7);
        bx?.stroke();
        p.x += vx * 0.7;
        p.y += vy * 0.7;
        if (p.x > W || p.y < 0 || p.y > H) {
          p.x = 0;
          p.y = Math.random() * H;
        }
      });
    }
    const u = mp(-2, 54);
    for (let i = 0; i < 3; i++) {
      const r = (t * 0.03 + i * 60) % 180;
      bx.strokeStyle = 'rgba(16,185,129,' + 0.5 * (1 - r / 180) + ')';
      bx.beginPath();
      bx.arc(u[0], u[1], r, 0, 7);
      bx.stroke();
    }
    bx.font = '11px Inter, sans-serif';
    FARMS.forEach((f) => {
      const q = mp(f[1], f[2]);
      bx!.fillStyle = EMERALD;
      bx!.beginPath();
      bx!.arc(q[0], q[1], 2.5, 0, 7);
      bx!.fill();
      bx!.fillStyle = isDark() ? 'rgba(161,161,170,.7)' : 'rgba(82,82,91,.75)';
      bx!.fillText(f[0], q[0] + 7, q[1] + 3);
    });
    raf = requestAnimationFrame(loopBg);
  }

  setupBg();
  raf = requestAnimationFrame(loopBg);
  const onResize = () => setupBg();
  window.addEventListener('resize', onResize);
  bgRedraws.add(setupBg);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    bgRedraws.delete(setupBg);
  };
}
