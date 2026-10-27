'use strict';

// Downloader API for content the user owns or is authorised to download.
// Requires yt-dlp and ffmpeg (both included in the Docker image).
const express = require('express');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const crypto = require('node:crypto');
const multer = require('multer');
const { PNG } = require('pngjs');

const app = express();
app.set('trust proxy', 1); // trust the single reverse proxy used by Docker/Render
const PORT = Number(process.env.PORT || 8080);
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';
const COOKIES = process.env.COOKIES_FILE || '';
const DOWNLOAD_TIMEOUT_MS = Math.max(60_000, Number(process.env.DOWNLOAD_TIMEOUT_MS || 60 * 60 * 1000));
const JOB_TTL_MS = Math.max(60_000, Number(process.env.JOB_TTL_MS || 30 * 60 * 1000));
const ERROR_TTL_MS = 2 * 60 * 1000;
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_DOWNLOADS || 4));
const MAX_PER_IP = Math.max(1, Number(process.env.MAX_DOWNLOADS_PER_IP || 2));
const jobs = new Map();
const activePerIp = new Map();
const infoRequests = new Map();
const jobStarts = new Map();
const imageStarts = new Map();
let activeJobs = 0;
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Upload a PNG, JPG, or WEBP image.'), ok);
  }
});
const IMAGE_MODELS = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
const IMAGE_QUALITIES = new Set(['high', 'xhigh', 'max']);
const IMAGE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536', '1536x864', '2048x1152']);
const IMAGE_BACKGROUNDS = new Set(['auto', 'opaque', 'transparent']);
const IMAGE_FORMATS = new Set(['png', 'webp', 'jpeg']);

function configuredOpenAIKey() {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  // Treat the safe sample placeholder as missing rather than attempting paid requests with it.
  if (!key || /^(replace-with-your-openai-api-key|your-api-key-here|change-me)$/i.test(key)) return '';
  return key;
}

const FORMATS = {
  best: 'bv*+ba/b',
  '2160': 'bv*[height<=2160]+ba/b',
  '1440': 'bv*[height<=1440]+ba/b',
  '1080': 'bv*[height<=1080]+ba/b',
  '720': 'bv*[height<=720]+ba/b',
  audio: 'ba/b'
};

function cors(req, res, next) {
  const origin = req.headers.origin;
  const configured = String(process.env.ALLOWED_ORIGIN || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  const sameOrigin = Boolean(origin && origin === requestOrigin);
  const allowed = !origin || sameOrigin || configured.includes('*') || configured.includes(origin);
  if (!allowed) return res.status(403).json({ error: 'This website origin is not allowed to use the API. Set ALLOWED_ORIGIN on the backend to the exact frontend origin, including https://.' });
  if (origin) res.setHeader('Access-Control-Allow-Origin', configured.includes('*') && !sameOrigin ? '*' : origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
app.use(cors);
app.use(express.json({ limit: '24kb', strict: true }));

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const a = address.split('.').map(Number);
    const [x, y] = a;
    return x === 0 || x === 10 || x === 127 ||
      (x === 100 && y >= 64 && y <= 127) ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 192 && y === 0 && a[2] === 0) ||
      (x === 192 && y === 0 && a[2] === 2) ||
      (x === 192 && y === 88 && a[2] === 99) ||
      (x === 198 && (y === 18 || y === 19)) ||
      (x === 198 && y === 51 && a[2] === 100) ||
      (x === 203 && y === 0 && a[2] === 113) || x >= 224;
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
      /^fe[89ab]/.test(ip) || ip.startsWith('ff') || ip.startsWith('2001:db8:');
  }
  return true;
}

async function validatePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) throw new Error('Enter a video link shorter than 4,096 characters.');
  let parsed;
  try { parsed = new URL(raw); }
  catch { throw new Error('Enter a complete, valid http:// or https:// video link.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only http:// and https:// links are supported.');
  if (parsed.username || parsed.password) throw new Error('Links containing usernames or passwords are not supported.');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') ||
      hostname.endsWith('.test') || hostname.endsWith('.invalid') || hostname.endsWith('.example')) {
    throw new Error('Private or local-network URLs are not supported.');
  }
  const literalVersion = net.isIP(hostname);
  let addresses;
  if (literalVersion) addresses = [{ address: hostname }];
  else {
    try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error('The link host could not be resolved. Check the URL and try again.'); }
  }
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('Private, reserved, or local-network addresses cannot be downloaded.');
  }
  return parsed.href;
}

function baseArgs() {
  return ['--no-playlist', '--no-warnings', '--no-cache-dir', '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--js-runtimes', 'node', ...(COOKIES ? ['--cookies', COOKIES] : [])];
}

function tailMessage(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const useful = [...lines].reverse().find((line) => /ERROR:|error:|Unsupported URL|Unable to download|Sign in|private video|HTTP Error/i.test(line));
  const line = useful || lines.at(-1) || 'yt-dlp could not process this link.';
  return line.replace(/^ERROR:\s*/i, '').slice(0, 900);
}

function runYtDlp(args, { timeoutMs = 120_000, maxStdout = 16 * 1024 * 1024, onProgress, onChild } = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    let timedOut = false;
    let oversized = false;
    let child;
    try { child = spawn(YT_DLP, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (err) { reject(new Error(`Could not start yt-dlp: ${err.message}`)); return; }
    if (onChild) onChild(child);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 4000).unref?.();
    }, timeoutMs);
    timer.unref?.();
    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(result);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxStdout && !oversized) { oversized = true; child.kill('SIGTERM'); }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-40_000);
      if (onProgress) {
        const parts = (pending + text).split(/\r\n|\n|\r/);
        pending = parts.pop() || '';
        for (const line of parts) {
          const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
          if (m) onProgress(Math.min(99, Math.max(0, Number(m[1]))), line.trim());
        }
      }
    });
    child.once('error', (err) => {
      const message = err.code === 'ENOENT'
        ? 'yt-dlp is not installed on the downloader server. Use the supplied Docker setup or install yt-dlp and ffmpeg.'
        : `Could not start yt-dlp: ${err.message}`;
      finish(new Error(message));
    });
    child.once('close', (code) => {
      if (timedOut) return finish(new Error('The downloader timed out. Try a shorter video or a lower quality.'));
      if (oversized) return finish(new Error('The source returned too much metadata. Try a different link.'));
      if (code !== 0) return finish(new Error(tailMessage(stderr)));
      finish(null, { stdout, stderr });
    });
  });
}

function jobView(job) {
  return {
    id: job.id,
    status: job.status,
    progress: Math.round(job.progress || 0),
    title: job.title,
    error: job.status === 'error' ? job.error : undefined,
    size: job.size || undefined,
    message: job.message || undefined
  };
}

function scheduleCleanup(job, delay) {
  clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => { void cleanupJob(job); }, delay);
  job.cleanupTimer.unref?.();
}

async function cleanupJob(job) {
  clearTimeout(job.cleanupTimer);
  jobs.delete(job.id);
  try { await fsp.rm(job.dir, { recursive: true, force: true }); } catch { /* temp cleanup is best effort */ }
}

function releaseActive(job) {
  if (job.countedActive) {
    job.countedActive = false;
    activeJobs = Math.max(0, activeJobs - 1);
    const n = Math.max(0, (activePerIp.get(job.ip) || 1) - 1);
    if (n) activePerIp.set(job.ip, n); else activePerIp.delete(job.ip);
  }
}

function allowWithinWindow(store, key, maxCount, windowMs) {
  const now = Date.now();
  const recent = (store.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= maxCount) { store.set(key, recent); return false; }
  recent.push(now);
  store.set(key, recent);
  return true;
}

function publicImageError(body, status) {
  const detail = body?.error?.message || body?.message || '';
  const code = body?.error?.code || body?.error?.type || '';
  if (status === 401 || status === 403) return 'OpenAI rejected the API key or project access. Check OPENAI_API_KEY and image-model permissions.';
  if (status === 429) return 'Image service rate limit or quota reached. Check billing, usage limits, and rate limits for your OpenAI project.';
  if (code === 'moderation_blocked' || String(detail).toLowerCase().includes('moderation')) return 'This prompt or reference image could not be processed. Try a different prompt or image.';
  if (/model.*(not found|access|available)|does not exist/i.test(detail)) return 'The configured image model is unavailable to this API project. Check model access and organization verification.';
  return String(detail || `The image service returned HTTP ${status}.`).slice(0, 900);
}

function imageOptions(body = {}) {
  const model = IMAGE_MODELS.has(body.model) ? body.model : 'gpt-image-2.5-sunburst';
  const quality = IMAGE_QUALITIES.has(body.quality) ? body.quality : 'high';
  const size = IMAGE_SIZES.has(body.size) ? body.size : '1024x1024';
  const requestedFormat = IMAGE_FORMATS.has(body.output_format || body.format) ? (body.output_format || body.format) : 'png';
  let background = IMAGE_BACKGROUNDS.has(body.background) ? body.background : 'auto';
  const format = requestedFormat;
  if (background === 'transparent' && format === 'jpeg') background = 'opaque';
  return { model, quality, size, output_format: format, background };
}

async function callAstraImageTool({ prompt, imageFile, options }) {
  const apiKey = configuredOpenAIKey();
  if (!apiKey) {
    const err = new Error('AI image generation is not configured yet. Add OPENAI_API_KEY to the backend environment, then restart/redeploy the server.');
    err.status = 503;
    throw err;
  }
  const content = [{ type: 'input_text', text: prompt }];
  if (imageFile) {
    content.push({
      type: 'input_image',
      image_url: `data:${imageFile.mimetype};base64,${imageFile.buffer.toString('base64')}`,
      detail: 'high'
    });
  }
  const payload = {
    model: process.env.OPENAI_RESPONSES_MODEL || 'gpt-6-astra',
    input: [{ role: 'user', content }],
    tool_choice: { type: 'image_generation' },
    tools: [{
      type: 'image_generation',
      model: options.model,
      action: imageFile ? 'edit' : 'generate',
      quality: options.quality,
      size: options.size,
      background: options.background,
      output_format: options.output_format
    }]
  };
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8 * 60 * 1000)
    });
  } catch (err) {
    const message = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      ? 'Image generation took too long. Try a smaller canvas or a shorter prompt.'
      : 'Could not connect to the OpenAI image service from the backend. Check backend internet access and try again.';
    const wrapped = new Error(message); wrapped.status = 502; throw wrapped;
  }
  const bodyText = await response.text();
  let data;
  try { data = JSON.parse(bodyText); } catch { data = {}; }
  if (!response.ok) {
    const err = new Error(publicImageError(data, response.status));
    err.status = response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 502 : 502;
    throw err;
  }
  const imageCall = Array.isArray(data.output) ? data.output.find((item) => item?.type === 'image_generation_call' && item.result) : null;
  if (!imageCall?.result) {
    const err = new Error(data.output_text || 'The image service returned no image. Try a different prompt or quality setting.');
    err.status = 502;
    throw err;
  }
  const format = options.output_format;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return {
    imageDataUrl: `data:${mime};base64,${imageCall.result}`,
    model: options.model,
    orchestrationModel: payload.model,
    format,
    size: options.size,
    quality: options.quality,
    background: options.background,
    outputText: String(data.output_text || '').slice(0, 1200),
    responseId: data.id || ''
  };
}

function allowImageRequest(req, res, next) {
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  if (!allowWithinWindow(imageStarts, ip, 6, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many image requests from this connection. Wait a few minutes and try again.' });
  }
  next();
}

app.get('/api/images/health', (_req, res) => {
  res.json({
    ok: true,
    configured: Boolean(configuredOpenAIKey()),
    orchestrationModel: process.env.OPENAI_RESPONSES_MODEL || 'gpt-6-astra',
    imageModels: [...IMAGE_MODELS],
    message: configuredOpenAIKey() ? 'API key is configured. Model access and billing will be verified on the first generation/edit request.' : 'Set OPENAI_API_KEY to a real key on the backend to enable image generation and edits.'
  });
});

app.post('/api/images/generate', allowImageRequest, async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Write a prompt describing the image you want to create.' });
  if (prompt.length > 12000) return res.status(400).json({ error: 'Keep the prompt under 12,000 characters.' });
  try {
    const options = imageOptions(req.body);
    const result = await callAstraImageTool({ prompt, options });
    res.json({ ok: true, prompt, ...result });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Image generation failed.' });
  }
});

app.post('/api/images/edit', allowImageRequest, (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 413 : 400;
      return res.status(status).json({ error: err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 'Reference image must be 20 MB or smaller.' : err.message || 'Could not read the uploaded image.' });
    }
    next();
  });
}, async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Describe what you want to change in the image.' });
  if (!req.file) return res.status(400).json({ error: 'Choose a reference image to edit.' });
  if (prompt.length > 12000) return res.status(400).json({ error: 'Keep the edit prompt under 12,000 characters.' });
  try {
    const options = imageOptions(req.body);
    const result = await callAstraImageTool({ prompt, imageFile: req.file, options });
    res.json({ ok: true, prompt, ...result });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || 'Image editing failed.' });
  }
});

app.post('/api/images/psd', allowImageRequest, (req, res, next) => {
  imageUpload.single('image')(req, res, (err) => {
    if (err) {
      const status = err instanceof multer.MulterError ? 413 : 400;
      return res.status(status).json({ error: err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE' ? 'PSD image must be 20 MB or smaller.' : err.message || 'Could not read the image for PSD export.' });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Send the generated PNG to export a PSD.' });
  if (req.file.mimetype !== 'image/png') return res.status(400).json({ error: 'PSD export requires a PNG. The website converts the current preview to PNG automatically.' });
  const caption = String(req.body?.caption || '').trim().slice(0, 300);
  try {
    const png = PNG.sync.read(req.file.buffer);
    const { width, height, data } = png;
    if (!width || !height || width > 12000 || height > 12000 || width * height > 64_000_000) {
      return res.status(400).json({ error: 'The image dimensions are too large for PSD export. Resize it first.' });
    }
    const pixels = new Uint8ClampedArray(data);
    const imageData = { width, height, data: pixels };
    const children = [{
      name: 'AI Generated Artwork', left: 0, top: 0, right: width, bottom: height,
      imageData: { width, height, data: new Uint8ClampedArray(pixels) }
    }];
    if (caption) {
      const position = String(req.body?.position || 'bottom');
      const y = position === 'top' ? Math.round(height * 0.12) : position === 'center' ? Math.round(height * 0.52) : Math.round(height * 0.86);
      const requestedSize = Number(req.body?.fontSize || 64);
      const fontSize = Math.max(8, Math.min(300, Number.isFinite(requestedSize) ? requestedSize : 64));
      const colorRaw = String(req.body?.color || '#ffffff');
      const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw.slice(1) : 'ffffff';
      children.push({
        name: 'Editable Text — ' + caption.slice(0, 80), left: 0, top: 0, right: width, bottom: height,
        text: {
          text: caption,
          transform: [1, 0, 0, 1, Math.round(width * 0.06), y],
          style: {
            font: { name: 'ArialMT' }, fontSize,
            fillColor: { r: parseInt(color.slice(0, 2), 16), g: parseInt(color.slice(2, 4), 16), b: parseInt(color.slice(4, 6), 16) }
          }
        }
      });
    }
    const agPsd = await import('ag-psd');
    const writePsdBuffer = agPsd.writePsdBuffer || agPsd.default?.writePsdBuffer;
    if (typeof writePsdBuffer !== 'function') throw new Error('PSD export module failed to load. Rebuild the backend dependencies and retry.');
    const psd = { width, height, imageData, children, bitsPerChannel: 8 };
    const output = writePsdBuffer(psd, { noBackground: true, generateThumbnail: false, invalidateTextLayers: true });
    res.setHeader('Content-Type', 'image/vnd.adobe.photoshop');
    res.setHeader('Content-Disposition', 'attachment; filename="designing-by-shaban-editable.psd"');
    res.setHeader('Content-Length', output.length);
    res.send(output);
  } catch (err) {
    console.error('PSD export failed:', err?.message || err);
    res.status(500).json({ error: 'PSD export failed. Use PNG/SVG export or rebuild the backend PSD dependencies, then retry.' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    const { stdout } = await runYtDlp(['--version'], { timeoutMs: 8_000, maxStdout: 100_000 });
    res.json({ ok: true, service: 'designing-by-shaban-downloader', ytDlpReady: true, version: stdout.trim(), activeJobs, maxConcurrentDownloads: MAX_CONCURRENT, imageGenerationConfigured: Boolean(configuredOpenAIKey()) });
  } catch (err) {
    res.status(503).json({ ok: false, ytDlpReady: false, error: err.message });
  }
});

app.get('/api/info', async (req, res) => {
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  if (!allowWithinWindow(infoRequests, ip, 20, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many link checks from this connection. Wait a few minutes and try again.' });
  try {
    const url = await validatePublicUrl(req.query.url);
    const { stdout } = await runYtDlp([...baseArgs(), '--dump-single-json', '--skip-download', '--', url], { timeoutMs: 150_000 });
    let data;
    try { data = JSON.parse(stdout); }
    catch { throw new Error('The source returned invalid video information. Update yt-dlp and try again.'); }
    res.json({
      title: String(data.title || 'Video').slice(0, 300),
      thumbnail: typeof data.thumbnail === 'string' && /^https:\/\//i.test(data.thumbnail) ? data.thumbnail : '',
      duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
      uploader: String(data.uploader || '').slice(0, 200),
      heights: [...new Set((data.formats || []).map((f) => f.height).filter((h) => Number.isFinite(h)))].sort((a, b) => b - a).slice(0, 30)
    });
  } catch (err) {
    res.status(422).json({ error: err.message || 'This link could not be read.' });
  }
});

app.post('/api/downloads', async (req, res) => {
  let url;
  try { url = await validatePublicUrl(req.body?.url); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  const quality = FORMATS[req.body?.q] ? req.body.q : 'best';
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
  if (!allowWithinWindow(jobStarts, ip, 8, 10 * 60 * 1000)) return res.status(429).json({ error: 'Too many download starts from this connection. Please wait a few minutes.' });
  if (activeJobs >= MAX_CONCURRENT) return res.status(429).json({ error: 'The downloader is busy. Please wait for another download to finish.' });
  if ((activePerIp.get(ip) || 0) >= MAX_PER_IP) return res.status(429).json({ error: `Only ${MAX_PER_IP} simultaneous downloads are allowed from this connection.` });

  const id = crypto.randomBytes(18).toString('hex');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'shaban-dl-'));
  const audio = quality === 'audio';
  const title = String(req.body?.title || 'Video').slice(0, 300);
  const job = {
    id, dir, ip, url, quality, title, status: 'queued', progress: 0,
    message: 'Queued', error: '', filePath: '', downloadName: audio ? 'video-by-shaban.mp3' : 'video-by-shaban.mp4',
    size: 0, child: null, countedActive: false, cleanupTimer: null, createdAt: Date.now()
  };
  jobs.set(id, job);
  activeJobs++;
  activePerIp.set(ip, (activePerIp.get(ip) || 0) + 1);
  job.countedActive = true;
  job.status = 'downloading';
  job.message = 'Preparing download';
  res.status(202).json(jobView(job));

  (async () => {
    try {
      const output = path.join(dir, 'file.%(ext)s');
      const args = [...baseArgs(), '--newline', '--progress', '-f', FORMATS[quality],
        ...(audio ? ['-x', '--audio-format', 'mp3', '--audio-quality', '0'] : ['--merge-output-format', 'mp4']),
        '-o', output, '--', url];
      await runYtDlp(args, {
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        maxStdout: 2 * 1024 * 1024,
        onChild: (child) => { job.child = child; },
        onProgress: (progress, line) => { job.progress = progress; job.message = line || `Downloading ${progress}%`; }
      });
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const files = entries.filter((e) => e.isFile() && !/\.(part|ytdl|json|jpg|webp|png)$/i.test(e.name));
      if (!files.length) throw new Error('yt-dlp finished but no downloadable output file was created. Check that ffmpeg is installed.');
      const file = files.sort((a, b) => a.name.length - b.name.length)[0];
      job.filePath = path.join(dir, file.name);
      const stat = await fsp.stat(job.filePath);
      if (!stat.size) throw new Error('The downloaded file is empty. Try another quality.');
      job.size = stat.size;
      job.downloadName = audio ? 'video-by-shaban.mp3' : `video-by-shaban${path.extname(file.name) || '.mp4'}`;
      job.status = 'ready';
      job.progress = 100;
      job.message = 'Ready to download';
      scheduleCleanup(job, JOB_TTL_MS);
    } catch (err) {
      job.status = 'error';
      job.error = String(err.message || 'Download failed.').slice(0, 1000);
      job.message = 'Download failed';
      scheduleCleanup(job, ERROR_TTL_MS);
    } finally {
      job.child = null;
      releaseActive(job);
    }
  })();
});

app.get('/api/downloads/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'This download job expired or does not exist. Start it again.' });
  res.json(jobView(job));
});

app.get('/api/downloads/:id/file', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'This download expired. Start the download again.' });
  if (job.status === 'error') return res.status(422).json({ error: job.error || 'Download failed.' });
  if (job.status !== 'ready' || !job.filePath) return res.status(409).json({ error: 'The file is not ready yet.' });
  clearTimeout(job.cleanupTimer);
  res.setHeader('Content-Type', job.quality === 'audio' ? 'audio/mpeg' : 'application/octet-stream');
  res.download(job.filePath, job.downloadName, (err) => {
    if (err) {
      console.error('File response failed:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'The file could not be sent. Please try the download link again.' });
    }
    // Keep the ready file briefly so a blocked browser auto-download can be retried by clicking the visible link.
    scheduleCleanup(job, 5 * 60 * 1000);
  });
});

app.delete('/api/downloads/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Download job not found.' });
  if (job.child && job.child.exitCode === null) job.child.kill('SIGTERM');
  job.status = 'error';
  job.error = 'Download cancelled.';
  job.message = 'Cancelled';
  releaseActive(job);
  scheduleCleanup(job, ERROR_TTL_MS);
  res.json({ ok: true });
});

// The root Docker deployment serves the frontend and API from one origin. This avoids
// API_BASE/CORS misconfiguration for a single-host deployment. Static files are restricted
// to the generated public/ directory so .env and server source files are never exposed.
const STATIC_DIR = process.env.STATIC_DIR || (fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public')
  : path.resolve(__dirname, '../public'));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  next();
});
app.use(express.static(STATIC_DIR, {
  index: 'index.html',
  dotfiles: 'deny',
  fallthrough: true,
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (/\.(?:js|css|svg|wasm)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));
app.use((req, res) => res.status(404).type('text/plain').send('Page not found. Return to the Designing by Shaban homepage.'));

app.use((err, _req, res, _next) => {
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON request.' });
  if (err instanceof multer.MulterError) return res.status(413).json({ error: 'Uploaded file is too large or invalid.' });
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'Unexpected downloader server error.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Designing by Shaban web + API listening on port ${PORT}`);
  console.log(`Static website directory: ${STATIC_DIR}`);
  console.log(`yt-dlp executable: ${YT_DLP}`);
  console.log(`Allowed origin(s): ${process.env.ALLOWED_ORIGIN || 'same-origin only'}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  for (const job of jobs.values()) if (job.child && job.child.exitCode === null) job.child.kill('SIGTERM');
  setTimeout(() => process.exit(1), 5000).unref?.();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
