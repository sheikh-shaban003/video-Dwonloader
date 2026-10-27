import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'logo.svg', 'favicon.svg', 'robots.txt']) {
  await cp(path.join(root, name), path.join(out, name));
}
for (const dir of ['css', 'js']) {
  await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
}
console.log('Netlify static assets prepared in public/. Server sources and environment files are not copied to the publish directory.');
