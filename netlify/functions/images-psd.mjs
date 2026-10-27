import pngjs from 'pngjs';
import * as agPsd from 'ag-psd';
import { guard, json } from '../lib/images-common.mjs';

const { PNG } = pngjs;
const MAX_PSD_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_FUNCTION_OUTPUT_BYTES = 5 * 1024 * 1024;

function psdError(message, status = 400) { return json({ error: message }, status); }

export default async function imagesPsd(request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  if (request.method !== 'POST') return psdError('Use POST to export a PSD.', 405);
  let form;
  try { form = await request.formData(); } catch { return psdError('Could not read the PSD upload. The image may exceed this host’s request limit.'); }
  const file = form.get('image');
  if (!(file instanceof File) || !file.size) return psdError('Send the generated PNG to export a PSD.');
  if (file.type !== 'image/png') return psdError('PSD export requires a PNG. The website converts the current preview to PNG automatically.');
  if (file.size > MAX_PSD_INPUT_BYTES) return psdError('This PNG is too large for Netlify’s function payload limit. Connect the Docker backend in js/config.js for larger PSD exports.', 413);
  const caption = String(form.get('caption') || '').trim().slice(0, 300);
  try {
    const png = PNG.sync.read(Buffer.from(await file.arrayBuffer()));
    const { width, height, data } = png;
    if (!width || !height || width > 12000 || height > 12000 || width * height > 64_000_000) return psdError('The image dimensions are too large for PSD export. Resize it first.');
    const pixels = new Uint8ClampedArray(data);
    const imageData = { width, height, data: pixels };
    const children = [{ name: 'AI Generated Artwork', left: 0, top: 0, right: width, bottom: height, imageData: { width, height, data: new Uint8ClampedArray(pixels) } }];
    if (caption) {
      const position = String(form.get('position') || 'bottom');
      const y = position === 'top' ? Math.round(height * .12) : position === 'center' ? Math.round(height * .52) : Math.round(height * .86);
      const requested = Number(form.get('fontSize') || 64);
      const fontSize = Math.max(8, Math.min(300, Number.isFinite(requested) ? requested : 64));
      const raw = String(form.get('color') || '#ffffff');
      const color = /^#[0-9a-f]{6}$/i.test(raw) ? raw.slice(1) : 'ffffff';
      children.push({
        name: `Editable Text — ${caption.slice(0, 80)}`, left: 0, top: 0, right: width, bottom: height,
        text: { text: caption, transform: [1, 0, 0, 1, Math.round(width * .06), y], style: {
          font: { name: 'ArialMT' }, fontSize,
          fillColor: { r: parseInt(color.slice(0, 2), 16), g: parseInt(color.slice(2, 4), 16), b: parseInt(color.slice(4, 6), 16) }
        } }
      });
    }
    const writePsdBuffer = agPsd.writePsdBuffer || agPsd.default?.writePsdBuffer;
    if (typeof writePsdBuffer !== 'function') throw new Error('PSD export dependency is unavailable.');
    const output = writePsdBuffer({ width, height, imageData, children, bitsPerChannel: 8 }, { noBackground: true, generateThumbnail: false, invalidateTextLayers: true });
    if (output.length > MAX_FUNCTION_OUTPUT_BYTES) return psdError('The generated PSD exceeds Netlify’s safe response size. Connect the Docker backend in js/config.js for large PSD exports.', 413);
    return new Response(output, { status: 200, headers: {
      'Content-Type': 'image/vnd.adobe.photoshop',
      'Content-Disposition': 'attachment; filename="designing-by-shaban-editable.psd"',
      'Content-Length': String(output.length), 'Cache-Control': 'no-store'
    } });
  } catch (error) {
    console.error('Netlify PSD export failed:', error?.message || error);
    return psdError('PSD export failed. Try PNG/SVG export or connect the Docker backend for larger images.', 500);
  }
}
export const config = { path: '/api/images/psd' };
