const base = String(process.argv[2] || 'http://localhost:8088').replace(/\/$/, '');
const tests = [
  ['/api/health', 'Video downloader backend'],
  ['/api/images/health', 'AI image service']
];
let failed = false;
console.log(`Checking: ${base}`);
for (const [route, label] of tests) {
  try {
    const response = await fetch(`${base}${route}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      const text = (await response.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
      console.error(`FAIL ${label}: HTTP ${response.status}, unexpected content-type ${type || '(missing)'}. Response: ${text}`);
      if (response.status === 404) console.error('Likely cause: this is a static-only deployment; deploy the root Dockerfile or add the API backend.');
      failed = true;
      continue;
    }
    const data = await response.json();
    if (!response.ok) { console.error(`FAIL ${label}: HTTP ${response.status}: ${data.error || JSON.stringify(data)}`); failed = true; continue; }
    if (route === '/api/health') {
      console.log(`${data.ok && data.ytDlpReady ? 'PASS' : 'WARN'} ${label}: yt-dlp ${data.version || (data.ytDlpReady ? 'ready' : 'not ready')}; image API key configured: ${Boolean(data.imageGenerationConfigured)}`);
      if (!data.ok || !data.ytDlpReady) failed = true;
    } else {
      console.log(`${data.ok && data.configured ? 'PASS' : 'WARN'} ${label}: key ${data.configured ? 'configured' : 'missing'}; orchestration model ${data.orchestrationModel || 'not reported'}`);
      if (!data.ok || !data.configured) failed = true;
    }
  } catch (error) {
    console.error(`FAIL ${label}: ${error.message}. Check the URL, service status, TLS and network access.`);
    failed = true;
  }
}
if (failed) {
  console.error('One or more checks failed. See DEPLOYMENT_GUIDE_ROMAN_URDU.md; this script does not create credentials or deploy a backend.');
  process.exit(1);
}
console.log('All API checks passed. Note: key configuration does not guarantee model access or API billing; test one image generation.');
