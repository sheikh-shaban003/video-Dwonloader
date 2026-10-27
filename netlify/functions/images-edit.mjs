import { guard, imageOptions, json, generateImage, publicError } from '../lib/images-common.mjs';

const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export default async function imagesEdit(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  if (request.method !== 'POST') return json({ error: 'Use POST to edit an image.' }, 405);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Could not read the image upload. Try a smaller PNG, JPG, or WEBP file.' }, 400); }
  const prompt = String(form.get('prompt') || '').trim();
  const file = form.get('image');
  if (!prompt) return json({ error: 'Describe what you want to change in the image.' }, 400);
  if (prompt.length > 12000) return json({ error: 'Keep the edit prompt under 12,000 characters.' }, 400);
  if (!(file instanceof File) || !file.size) return json({ error: 'Choose a reference image to edit.' }, 400);
  if (!ALLOWED_TYPES.has(file.type)) return json({ error: 'Upload a PNG, JPG, or WEBP reference image.' }, 400);
  if (file.size > MAX_REFERENCE_BYTES) return json({ error: 'Netlify image edits support reference files up to 4 MB. Use a smaller image, or connect the Docker backend for larger references.' }, 413);
  try {
    const options = imageOptions({
      model: form.get('model'), quality: form.get('quality'), size: form.get('size'),
      background: form.get('background'), output_format: form.get('output_format')
    });
    const result = await generateImage({ prompt, imageFile: file, options });
    return json({ ok: true, prompt, ...result });
  } catch (error) {
    return publicError(error, 'Image editing failed.');
  }
}
export const config = { path: '/api/images/edit' };
