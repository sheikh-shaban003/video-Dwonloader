import { apiKey, guard, json } from '../lib/images-common.mjs';

export default async function imagesHealth(request) {
  const blocked = guard(request, { rateLimit: false });
  if (blocked) return blocked;
  return json({
    ok: true,
    configured: Boolean(apiKey()),
    orchestrationModel: process.env.OPENAI_RESPONSES_MODEL || 'gpt-6-astra',
    imageModels: ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'],
    service: 'netlify-functions',
    message: apiKey()
      ? 'API key configured. Model access and billing will be checked on first generation/edit request.'
      : 'Set OPENAI_API_KEY in Netlify Site configuration → Environment variables, then redeploy.'
  });
}
export const config = { path: '/api/images/health' };
