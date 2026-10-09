// Downloads OpenStreetMap buildings, roads and green areas around a point.
//   node scripts/fetch-osm.mjs <lat> <lon> <radiusMetres> <out.json>
// Data © OpenStreetMap contributors, ODbL.
import { writeFile } from 'node:fs/promises';

const [lat, lon, radius, out] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/fetch-osm.mjs <lat> <lon> <radius> <out.json>');
  process.exit(1);
}

const around = `(around:${radius},${lat},${lon})`;
const query = `[out:json][timeout:180];
(
  way["building"]${around};
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|service|living_street|pedestrian)$"]${around};
  way["leisure"~"^(park|garden|pitch|playground)$"]${around};
  way["landuse"~"^(grass|recreation_ground|forest|meadow|village_green|construction)$"]${around};
  way["natural"~"^(water|wood|scrub)$"]${around};
);
out geom tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': 'kaide-demo/1.0 (personal test project)', 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const json = await res.json();
json.center = { lat: +lat, lon: +lon };
await writeFile(out, JSON.stringify(json));
const count = (pred) => json.elements.filter(pred).length;
console.log(
  `buildings ${count((e) => e.tags.building)}, roads ${count((e) => e.tags.highway)}, green ${count((e) => e.tags.leisure || e.tags.landuse || e.tags.natural)}`
);
