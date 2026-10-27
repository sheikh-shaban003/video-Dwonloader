import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mustExist = [
  'index.html','public/index.html','Dockerfile','docker-compose.yml','server/server.js',
  'server/package.json','js/config.js','js/video.js','js/imagegen.js',
  'netlify/functions/images-health.mjs','netlify/functions/images-generate.mjs',
  'netlify/functions/images-edit.mjs','netlify/functions/images-psd.mjs',
  'DEPLOYMENT_GUIDE_ROMAN_URDU.md','START_HERE_ROMAN_URDU.txt','start-website-windows.bat','render.yaml','scripts/diagnose-deployment.mjs'
];
let failed = false;
for (const file of mustExist) {
  try { await access(path.join(root, file)); } catch { console.error(`MISSING: ${file}`); failed = true; }
}
const checks = [
  'server/server.js','js/app.js','js/nav.js','js/resizer.js','js/studio.js','js/video.js','js/imagegen.js',
  'netlify/functions/images-health.mjs','netlify/functions/images-generate.mjs','netlify/functions/images-edit.mjs','netlify/functions/images-psd.mjs','netlify/lib/images-common.mjs','scripts/diagnose-deployment.mjs'
];
for (const file of checks) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(`SYNTAX ERROR: ${file}\n${result.stderr || result.stdout}`); failed = true; }
}
const compose = await readFile(path.join(root, 'docker-compose.yml'), 'utf8');
if (!compose.includes('dockerfile: Dockerfile') || !compose.includes('8088:8080')) { console.error('Compose is not configured for the single-origin root Dockerfile.'); failed = true; }
const server = await readFile(path.join(root, 'server/server.js'), 'utf8');
for (const route of ['/api/health','/api/images/health','/api/images/generate','/api/images/edit','/api/images/psd','/api/info','/api/downloads']) {
  if (!server.includes(route)) { console.error(`API ROUTE MISSING: ${route}`); failed = true; }
}
if (failed) process.exit(1);
console.log(`Project verification passed: ${mustExist.length} required files, ${checks.length} JavaScript syntax checks, and API route/config checks.`);
