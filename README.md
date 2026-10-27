# Designing by Shaban — Full Creative Toolkit

This repository contains the complete website source, image converter/resizer, design workspace, AI image generator/editor, Photoshop-compatible PSD export, video converter/editor, and a real `yt-dlp` + FFmpeg downloader backend.

## Recommended setup: one website + one backend URL

The root `Dockerfile` runs the static website and the Express API in the same container. This is the easiest route if you need **both Video Downloader and AI Image Studio** to work on one domain.

### Windows local setup

1. Install Docker Desktop and start it: https://www.docker.com/products/docker-desktop/
2. Copy `.env.example` to `.env`. Replace the placeholder with your OpenAI API key to enable AI generation/editing; video downloads do not need this key.
3. Run `start-website-windows.bat`, or use:

   ```bash
   docker compose up --build -d
   ```

4. Open http://localhost:8088
5. Check `http://localhost:8088/api/health` and `http://localhost:8088/api/images/health`. You can also run `node scripts/diagnose-deployment.mjs http://localhost:8088` from the project root.

The first build downloads Node dependencies, FFmpeg, and yt-dlp; internet access is required. Use `docker compose logs --tail=150 website` for build/runtime logs and `docker compose down` to stop.

## Deploy one URL publicly

Deploy the repository **root** using its root `Dockerfile` on a Docker-capable host. Do not deploy only `index.html` or `public/`, and do not set the project root directory to `server/` if you want the frontend and backend on the same URL. Add `OPENAI_API_KEY` as a server-side hosting environment variable. Set `ALLOWED_ORIGIN` only when the frontend is hosted on another origin; for a separate frontend, set it to that exact `https://` origin.

Start with [`START_HERE_ROMAN_URDU.txt`](START_HERE_ROMAN_URDU.txt), then use the full [`DEPLOYMENT_GUIDE_ROMAN_URDU.md`](DEPLOYMENT_GUIDE_ROMAN_URDU.md).

## If the frontend is hosted on Netlify

Static Netlify deployment by itself does not run the long-running video downloader. For image APIs, the repository also includes Netlify Functions, which must be deployed through the complete Git-connected repository or Netlify CLI, with `OPENAI_API_KEY` set in Site configuration → Environment variables. For video-page downloads, deploy the Docker backend separately and set backend `ALLOWED_ORIGIN` to your frontend origin. In the website UI, enter the backend’s public HTTPS origin (no `/api` suffix) in the Backend URL field on either Video Downloader or AI Image Generator; the setting is shared and saved in that browser. Alternatively, set `API_BASE` in `js/config.js` before deploying.

## AI image generation

The backend calls the OpenAI Responses API with `gpt-6-astra` as the orchestration model and `gpt-image-2.5-sunburst` or `gpt-image-2.5-flare` for the image-generation tool. Supported image models, options and API access can change; see the [official image-generation documentation](https://developers.openai.com/api/docs/guides/tools-image-generation). A valid API key and API billing/model access are required. ChatGPT subscription access is not the same as API billing.

The AI Studio supports prompt-to-image, reference image editing, PNG/WEBP/JPEG download, editable SVG caption export, project JSON, and a PSD with a raster artwork layer plus an optional separate text layer. The complete generated scene is not automatically broken into individually editable objects.

## Backend APIs

- `GET /api/health` — server/yt-dlp readiness.
- `GET /api/images/health` — AI key configuration status.
- `POST /api/images/generate` — generate image from JSON prompt/settings.
- `POST /api/images/edit` — edit a PNG/JPG/WEBP reference image.
- `POST /api/images/psd` — export a Photoshop-compatible PSD.
- `GET /api/info?url=...` — get video metadata.
- `POST /api/downloads` — begin a permitted download job.
- `GET /api/downloads/:id` — download progress/status.
- `GET /api/downloads/:id/file` — retrieve a completed file.
- `DELETE /api/downloads/:id` — cancel a job.

Use the downloader only for content you own or are authorized to download. The service does not bypass DRM or paywalls.
