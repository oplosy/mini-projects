// Turns raw OpenStreetMap data into scene-ready city data for blender/build_city.py.
//   node scripts/build-city.mjs <osm.json> <out.json>
//
// Output is in the site's three.js frame: metres, x east, z south, our tower at the origin.
// The city is rotated so the Ataşehir finance district stands behind the tower at sunset,
// and buildings that would block the camera journey are removed.
import { readFile, writeFile } from 'node:fs/promises';

const [src, out] = process.argv.slice(2);
const osm = JSON.parse(await readFile(src, 'utf8'));
const { lat: lat0, lon: lon0 } = osm.center;

const RADIUS = 1650; // keep this much of the city
const ROTATION = -0.5; // radians, added to atan2(z, x)
const SITE_CLEAR = 80; // our plot
const ROAD_CLEAR = 72; // roads stop at the hoarding
const R = 6378137;
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180);
const ky = (Math.PI / 180) * R;
const cr = Math.cos(ROTATION);
const sr = Math.sin(ROTATION);

function local({ lat, lon }) {
  const x = (lon - lon0) * kx;
  const z = -(lat - lat0) * ky;
  return [+(x * cr - z * sr).toFixed(2), +(x * sr + z * cr).toFixed(2)];
}

function hash(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

// Camera journey (see src/world/index.js): orbit samples plus the flight keyframes, [x, y, z]
const path = [];
for (let i = 0; i <= 40; i++) {
  const p = i / 40;
  const ang = -0.75 + p * 1.25;
  const r = 70 + 150 * p;
  path.push([Math.cos(ang) * r, 14 + 40 * (1 - p), Math.sin(ang) * r]);
}
const keys = [[76, 58, -40], [24, 68, -7], [-14.5, 68, 0], [-62, 96, 58], [60, 130, 160], [190, 125, 165]];
for (let i = 0; i < keys.length - 1; i++) {
  for (let s = 0; s <= 10; s++) {
    const a = keys[i];
    const b = keys[i + 1];
    path.push(a.map((v, k) => v + (b[k] - v) * (s / 10)));
  }
}

function blocksCamera(pts, h) {
  for (const [px, py, pz] of path) {
    if (h < py - 12) continue;
    for (const [x, z] of pts) if (Math.hypot(x - px, z - pz) < 38) return true;
  }
  return false;
}

// The build-chapter camera looks at the tower from this wedge; keep it open
function inBuildWedge(pts) {
  return pts.some(([x, z]) => {
    const d = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    return d < 240 && a > -1.05 && a < 0.8;
  });
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function heightOf(e) {
  const t = e.tags;
  const h = num(t.height);
  if (h > 0) return h;
  const levels = num(t['building:levels']);
  if (levels > 0) return levels * 3.1 + 1;
  const r = hash(e.id);
  switch (t.building) {
    case 'house':
    case 'detached':
      return 6 + r * 4;
    case 'garage':
    case 'garages':
    case 'shed':
    case 'roof':
    case 'kiosk':
      return 3 + r;
    case 'industrial':
    case 'warehouse':
    case 'retail':
    case 'supermarket':
      return 8 + r * 6;
    case 'school':
    case 'hospital':
    case 'public':
    case 'government':
    case 'university':
      return 12 + r * 8;
    case 'mosque':
      return 14 + r * 6;
    case 'construction':
      return 0; // handled as a site
    default:
      // typical Istanbul apartment blocks: 4 to 9 storeys
      return (4 + Math.floor(r * 6)) * 3.1 + 1;
  }
}

const kindOf = (t) => {
  if (['office', 'commercial'].includes(t.building) || t.office) return 'office';
  if (['school', 'hospital', 'public', 'government', 'university', 'mosque', 'civic'].includes(t.building) || t.amenity) return 'public';
  if (t.building === 'construction') return 'construction';
  return 'residential';
};

function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

const buildings = [];
const roads = [];
const green = [];
let dropped = 0;

for (const e of osm.elements) {
  if (!e.geometry || e.geometry.length < 2) continue;
  let pts = e.geometry.map(local);
  const t = e.tags;

  if (t.building) {
    if (pts.length < 4) continue;
    pts = pts.slice(0, -1); // closed ring: drop the repeated first point
    if (pts.some(([x, z]) => Math.hypot(x, z) > RADIUS)) continue;
    if (Math.abs(area(pts)) < 12) continue;
    const h = heightOf(e);
    if (h <= 0) continue;
    const near = pts.some(([x, z]) => Math.hypot(x, z) < SITE_CLEAR);
    if (near || inBuildWedge(pts) || blocksCamera(pts, h)) {
      dropped++;
      continue;
    }
    if (area(pts) < 0) pts.reverse(); // consistent winding
    buildings.push({ id: e.id, pts, h: +h.toFixed(1), kind: kindOf(t), name: t.name ?? '' });
  } else if (t.highway) {
    if (pts.every(([x, z]) => Math.hypot(x, z) > RADIUS)) continue;
    const width = {
      motorway: 22, trunk: 18, primary: 14, secondary: 11, tertiary: 9,
      motorway_link: 8, trunk_link: 8, primary_link: 7, secondary_link: 7, tertiary_link: 6,
      residential: 6.5, unclassified: 6, living_street: 5, service: 4, pedestrian: 5,
    }[t.highway] ?? 5;
    // our site is a closed plot: cut roads where they would cross it
    let run = [];
    const flush = () => {
      if (run.length > 1) roads.push({ cls: t.highway, w: width, pts: run });
      run = [];
    };
    for (const p of pts) {
      if (Math.hypot(p[0], p[1]) < ROAD_CLEAR + width / 2) flush();
      else run.push(p);
    }
    flush();
  } else {
    if (pts.length < 4 || pts.every(([x, z]) => Math.hypot(x, z) > RADIUS)) continue;
    const kind = t.natural === 'water' ? 'water' : t.landuse === 'construction' ? 'construction' : 'green';
    green.push({ kind, pts: pts.slice(0, -1) });
  }
}

// Disciplines: real buildings seen from the studio's west windows (looking -x, eye at 67.7 m)
const WINDOW = Math.PI;
const angleTo = (a) => Math.abs(((a - WINDOW + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
const centroid = (pts) => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
const view = buildings
  .map((b) => {
    const [cx, cz] = centroid(b.pts);
    return { b, a: Math.atan2(cz, cx), d: Math.hypot(cx, cz), off: angleTo(Math.atan2(cz, cx)), area: Math.abs(area(b.pts)) };
  })
  .filter((s) => s.off < 0.6 && s.d > 160 && s.d < 1500);
const officeName = /kule|tower|bank|ziraat|halk|vak[ıi]f|tcmb|plaza|ofis|office|finans/i;
const used = new Set();
const choose = (pred, score) => {
  const s = view.filter((v) => !used.has(v.b.id) && pred(v)).sort((x, y) => score(y) - score(x))[0];
  if (s) used.add(s.b.id);
  return s;
};
const districts = [
  choose((v) => v.b.kind === 'residential' && v.d < 800 && v.off < 0.45, (v) => v.b.h),
  choose((v) => v.b.kind === 'office' || officeName.test(v.b.name), (v) => v.b.h),
  choose((v) => v.b.kind === 'public' && v.b.h > 8 && v.d < 1000, (v) => v.area),
];
districts.forEach((s, i) => s && (s.b.district = i));

// Şantiye: the largest real construction plot in view, else an open spot
const sites = green
  .filter((g) => g.kind === 'construction')
  .map((g) => {
    const [cx, cz] = centroid(g.pts);
    return { g, cx, cz, d: Math.hypot(cx, cz), off: angleTo(Math.atan2(cz, cx)), area: Math.abs(area(g.pts)) };
  })
  .filter((s) => s.off < 0.5 && s.d > 200 && s.d < 900)
  .sort((a, b) => b.area - a.area);
const constructionSpot = sites[0]
  ? [+sites[0].cx.toFixed(1), +sites[0].cz.toFixed(1)]
  : [+(Math.cos(WINDOW - 0.35) * 420).toFixed(1), +(Math.sin(WINDOW - 0.35) * 420).toFixed(1)];
// nothing may stand on the crane's plot
for (let i = buildings.length - 1; i >= 0; i--) {
  if (buildings[i].pts.some(([x, z]) => Math.hypot(x - constructionSpot[0], z - constructionSpot[1]) < 34)) buildings.splice(i, 1);
}
await writeFile(
  out,
  JSON.stringify({
    source: 'OpenStreetMap contributors, ODbL',
    center: osm.center,
    rotation: ROTATION,
    buildings,
    roads,
    green,
    construction: constructionSpot,
  })
);

console.log(`buildings ${buildings.length} (dropped ${dropped} for the camera), roads ${roads.length}, green ${green.length}`);
districts.forEach((s, i) => s && console.log(`district ${i}: ${s.b.name || s.b.kind} h=${s.b.h} d=${s.d.toFixed(0)} a=${s.a.toFixed(2)}`));
