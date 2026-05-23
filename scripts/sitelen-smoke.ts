import { renderSitelenPng } from '../src/assets/sitelen-wasm';
import fs from 'fs';

const text = process.argv[2] || 'pilin pona li pana e sijelo pona.';
const png = renderSitelenPng(text);
const out = '/tmp/sitelen-smoke.png';
fs.writeFileSync(out, png);
console.log(`Text: ${text}`);
console.log(`PNG bytes: ${png.length}`);
console.log(`First 8 bytes: ${[...png.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
console.log(`Wrote: ${out}`);
