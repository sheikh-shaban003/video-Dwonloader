# Designing by Shaban — Setup Guide (Roman Urdu)

## Pehle yeh samjhein

Aapki screenshot mein “Downloader backend is not connected” aa raha hai kyun ke static website apne aap video-page link download nahi kar sakti. Website upload karna aur backend chalana alag cheezen hain. AI image generation ke liye backend ke saath asli `OPENAI_API_KEY` bhi zaroori hai. ZIP mein API key include nahi ki ja sakti.

## Option A — Apne Windows laptop par poori website chalayein (testing ke liye)

1. Docker Desktop install karein: https://www.docker.com/products/docker-desktop/
2. Docker Desktop open kar ke uske “Running” hone ka intezar karein.
3. Is project folder ko extract karein.
4. `.env.example` ki copy bana kar uska naam `.env` rakhein. AI image generator ke liye `.env` mein `OPENAI_API_KEY=` ke baad apni API key lagayein. Video downloader ke liye API key ki zaroorat nahi.
5. `start-website-windows.bat` par double-click karein, ya folder mein terminal khol kar `docker compose up --build -d` run karein. Pehli build internet se dependencies download karegi.
6. Website: http://localhost:8088
7. Downloader status: http://localhost:8088/api/health
8. Image service status: http://localhost:8088/api/images/health

Health endpoint mein `ok: true` aur `ytDlpReady: true` honi chahiye. AI service mein `configured: true` key configuration ka matlab hai; model access/billing ko pehli generation request test karegi.

## Option B — Website ko internet par ek hi URL par chalana

Is folder ko Git repository mein push karein. Aisi web hosting choose karein jo root `Dockerfile` ko build/run kar sake. Project root par deploy karein — `server/` ko root directory mat banayein. Root `Dockerfile` website, Node API, yt-dlp aur FFmpeg ko ek container mein install karta hai.

Hosting dashboard mein yeh server-side environment variables set karein:

- `OPENAI_API_KEY`: OpenAI API key (AI generation/editing ke liye zaroori; API billing alag hoti hai).
- `OPENAI_RESPONSES_MODEL`: `gpt-6-astra` (default).
- `ALLOWED_ORIGIN`: agar frontend aur backend same URL par hain to blank reh sakta hai. Separate frontend ke liye uska exact origin, e.g. `https://your-site.netlify.app`, configure karein.

Deploy ke baad `https://YOUR-DOMAIN/api/health` aur `https://YOUR-DOMAIN/api/images/health` test karein. Hosting ko Docker build aur long-running Node process support karna hoga. Video downloads ko server bandwidth/storage chahiye.

## Option C — Frontend Netlify par, backend alag

Netlify drag-and-drop/static upload se `server/server.js`, `yt-dlp`, FFmpeg ya long-running download jobs nahi chalte. Is setup mein:

1. Frontend ko complete repo ke saath Netlify Git integration/CLI se deploy karein (image Functions bhi chahiye hon to).
2. `server/` backend ko Docker-capable host par deploy karein.
3. Backend par `ALLOWED_ORIGIN` mein frontend ka exact URL set karein.
4. Frontend par Video Downloader ya AI Image Generator page khol kar **Backend URL** field mein backend ka public HTTPS origin paste karein (URL ke end par `/api` na likhein), phir Save karein. Yeh choice us browser mein save ho jati hai. Alternative: `js/config.js` mein `API_BASE` set karke frontend redeploy karein.

`js/config.js` example:

```js
window.SHABAN_CONFIG = { API_BASE: 'https://YOUR-BACKEND-HOST' };
```

## Common checks

- `/api/health` not found: backend deploy nahi hua, galat domain use ho raha hai, ya stale deploy chal raha hai.
- `ytDlpReady: false`: backend image/build logs check karein; yt-dlp install fail hua ho sakta hai.
- Downloader starts but fails on a particular video: link private/login-only ho sakta hai, platform extraction change hui ho sakti hai, ya platform cookies/sign-in required ho sakta hai. DRM/paywall bypass nahi hota.
- `/api/images/health` mein `configured: false`: environment variable ka naam `OPENAI_API_KEY` verify karein aur service restart/redeploy karein.
- API key present hone ke bawajood image create nahi hoti: API project billing, image-model access, moderation response aur server logs check karein. ChatGPT subscription aur API billing alag hoti hain.
- Agar aap sirf `index.html` ya `public/` upload karte hain to backend start nahi hota.

## Security

API key sirf server ke environment variables ya private `.env` mein rakhein. `js/config.js` ya HTML mein kabhi na paste karein. `.env` ko public repository mein commit na karein. Sirf woh videos download karein jinhein download karne ki permission ho.
