import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFile(join(root, name), 'utf8');

let html = await read('index.html');
const css = await read('style.css');
const script = await read('app.js');
const stylesheet = '<link rel="stylesheet" href="./style.css">';
const scriptTag = '<script src="./app.js"></script>';

if (!html.includes(stylesheet) || !html.includes(scriptTag)) {
  throw new Error('HTML entry points changed; update the standalone builder.');
}

html = html.replace(stylesheet, `<style>\n${css}\n</style>`);
html = html.replace(scriptTag, `<script>\n${script.replaceAll('</script', '<\\/script')}\n</script>`);

if (/(?:src|href)=["'](?:https?:|\.?\.?\/)/i.test(html) || /@import\b|\bfetch\s*\(/i.test(html)) {
  throw new Error('Standalone output still has an external resource reference.');
}

const output = join(root, 'Pelagic-Okyanus.html');
await writeFile(output, html, 'utf8');
console.log(`Standalone ocean ready: ${output} (${Buffer.byteLength(html)} bytes)`);
