import crypto from 'node:crypto';

const IMAGE_MODELS = new Set(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']);
const IMAGE_QUALITIES = new Set(['high', 'xhigh', 'max']);
const IMAGE_SIZES = new Set(['auto', '1024x1024', '1536x1024', '1024x1536', '1536x864', '2048x1152']);
const IMAGE_BACKGROUNDS = new Set(['auto', 'opaque', 'transparent']);
const IMAGE_FORMATS = new Set(['png', 'webp', 'jpeg']);
const MAX_IMAGE_REQUESTS = 6;
const WINDOW_MS = 10 * 60 * 1000;
const requestWindows = new Map();

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
  });
}

export function apiKey() {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key || /^(replace-with-your-openai-api-key|your-api-key-here|change-me)$/i.test(key)) return '';
  return key;
}

export function originAllowed(request) {
  const origin = request.headers.get('origin');
  // These functions are designed to be called from the same Netlify site. For a separately
  // hosted frontend/backend pair, use the Express backend which has explicit CORS support.
  if (!origin) return true;
  try { return origin === new URL(request.url).origin; } catch { return false; }
}

export function rateLimited(request) {
  const ip = request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const key = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24);
  const now = Date.now();
  const prior = (requestWindows.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (prior.length >= MAX_IMAGE_REQUESTS) {
    requestWindows.set(key, prior);
    return true;
  }
  prior.push(now);
  requestWindows.set(key, prior);
  if (requestWindows.size > 5000) {
    for (const [k, times] of requestWindows) if (!times.length || now - times[times.length - 1] > WINDOW_MS) requestWindows.delete(k);
  }
  return false;
}

export function guard(request, { rateLimit = true } = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (!originAllowed(request)) return json({ error: 'Netlify image functions are same-origin only. For a separate frontend/backend pair, set API_BASE and ALLOWED_ORIGIN on the supplied Express backend.' }, 403);
  if (rateLimit && request.method !== 'GET' && rateLimited(request)) return json({ error: 'Too many image requests from this connection. Wait a few minutes and try again.' }, 429);
  return null;
}

export function imageOptions(body = {}) {
  const model = IMAGE_MODELS.has(body.model) ? body.model : 'gpt-image-2.5-sunburst';
  const quality = IMAGE_QUALITIES.has(body.quality) ? body.quality : 'high';
  const size = IMAGE_SIZES.has(body.size) ? body.size : '1024x1024';
  const requestedFormat = IMAGE_FORMATS.has(body.output_format || body.format) ? (body.output_format || body.format) : 'png';
  let background = IMAGE_BACKGROUNDS.has(body.background) ? body.background : 'auto';
  if (background === 'transparent' && requestedFormat === 'jpeg') background = 'opaque';
  return { model, quality, size, output_format: requestedFormat, background };
}

function publicImageError(body, status) {
  const detail = body?.error?.message || body?.message || '';
  const code = body?.error?.code || body?.error?.type || '';
  if (status === 401 || status === 403) return 'OpenAI rejected the API key or project access. Check OPENAI_API_KEY and image-model permissions.';
  if (status === 429) return 'Image service rate limit or quota reached. Check OpenAI API billing, usage limits, and rate limits.';
  if (code === 'moderation_blocked' || String(detail).toLowerCase().includes('moderation')) return 'This prompt or reference image could not be processed. Try a different prompt or image.';
  if (/model.*(not found|access|available)|does not exist/i.test(detail)) return 'The configured image model is unavailable to this API project. Check model access and organization verification.';
  return String(detail || `The image service returned HTTP ${status}.`).slice(0, 900);
}

export async function generateImage({ prompt, imageFile, options }) {
  const key = apiKey();
  if (!key) {
    const error = new Error('Image generation is not configured. In Netlify, open Site configuration → Environment variables and add OPENAI_API_KEY, then redeploy the site. The key must stay server-side.');
    error.status = 503;
    throw error;
  }
  const content = [{ type: 'input_text', text: prompt }];
  if (imageFile) {
    content.push({
      type: 'input_image',
      image_url: `data:${imageFile.type};base64,${Buffer.from(await imageFile.arrayBuffer()).toString('base64')}`,
      detail: 'high'
    });
  }
  const requestPayload = {
    model: process.env.OPENAI_RESPONSES_MODEL || 'gpt-6-astra',
    input: [{ role: 'user', content }],
    tool_choice: { type: 'image_generation' },
    tools: [{
      type: 'image_generation', model: options.model,
      action: imageFile ? 'edit' : 'generate',
      quality: options.quality, size: options.size,
      background: options.background, output_format: options.output_format
    }]
  };
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(55_000)
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const error = new Error(timeout
      ? 'Image generation took longer than this serverless request allows. For slower high-quality jobs, deploy the supplied Docker backend and set API_BASE.'
      : 'Could not connect to the OpenAI image service. Check that the site function has outbound HTTPS access.');
    error.status = 502;
    throw error;
  }
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* never expose upstream HTML/CSS */ }
  if (!response.ok) {
    const error = new Error(publicImageError(data, response.status));
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const imageCall = Array.isArray(data.output)
    ? data.output.find(item => item?.type === 'image_generation_call' && item.result)
    : null;
  if (!imageCall?.result) {
    const error = new Error(data.output_text || 'The image service returned no image. Try a different prompt or quality setting.');
    error.status = 502;
    throw error;
  }
  const format = options.output_format;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  return {
    imageDataUrl: `data:${mime};base64,${imageCall.result}`,
    model: options.model,
    orchestrationModel: requestPayload.model,
    format, size: options.size, quality: options.quality,
    background: options.background,
    outputText: String(data.output_text || '').slice(0, 1200),
    responseId: data.id || ''
  };
}

export function publicError(error, fallback) {
  return json({ error: error?.message || fallback }, Number(error?.status) || 502);
}
