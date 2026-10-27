import { guard, imageOptions, json, generateImage, publicError } from '../lib/images-common.mjs';

export default async function imagesGenerate(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  if (request.method !== 'POST') return json({ error: 'Use POST to generate an image.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a valid JSON request body.' }, 400); }
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) return json({ error: 'Write a prompt describing the image you want to create.' }, 400);
  if (prompt.length > 12000) return json({ error: 'Keep the prompt under 12,000 characters.' }, 400);
  try {
    const options = imageOptions(body);
    const result = await generateImage({ prompt, options });
    return json({ ok: true, prompt, ...result });
  } catch (error) {
    return publicError(error, 'Image generation failed.');
  }
}
export const config = { path: '/api/images/generate' };
