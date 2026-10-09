// Downloads Poly Haven (CC0) glTF models with their textures for the Blender studio build.
//   node scripts/fetch-polyhaven.mjs <outDir> <id> [id...]
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [outDir, ...ids] = process.argv.slice(2);
if (!outDir || !ids.length) {
  console.error('usage: node scripts/fetch-polyhaven.mjs <outDir> <id> [id...]');
  process.exit(1);
}

async function save(url, path) {
  try {
    await access(path);
    return; // already downloaded
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

for (const id of ids) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf) {
    console.warn(`${id}: no 1k glTF`);
    continue;
  }
  const dir = join(outDir, id);
  await save(gltf.url, join(dir, `${id}.gltf`));
  for (const [rel, f] of Object.entries(gltf.include ?? {})) await save(f.url, join(dir, rel));
  console.log(`${id}: ok`);
}
