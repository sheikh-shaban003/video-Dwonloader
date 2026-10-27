(() => {
  const SB = window.SB, BASE = 'js/vendor/ffmpeg/', abs = (p) => new URL(p, location.href).href;
  let ff = null;
  const sel = (id, o) => `<select id="${id}">${o.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`;
  const fld = (l, h) => `<div class="field"><label>${l}</label>${h}</div>`;
  const OUT = [['mp4', 'MP4 (H.264)'], ['webm', 'WEBM'], ['mkv', 'MKV'], ['mov', 'MOV'], ['gif', 'GIF'], ['mp3', 'MP3 audio'], ['wav', 'WAV audio']];

  async function engine(log) {
    if (ff) return ff;
    log('Loading the video engine (about 30 MB, cached after the first time)…');
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = BASE + 'ffmpeg.js'; s.onload = ok; s.onerror = () => no(new Error('Video engine files are missing.')); document.head.append(s); });
    const f = new FFmpegWASM.FFmpeg();
    await f.load({ coreURL: abs(BASE + 'ffmpeg-core.js'), wasmURL: abs(BASE + 'ffmpeg-core.wasm'), classWorkerURL: abs(BASE + '814.ffmpeg.js') });
    return (ff = f);
  }

  function mount(root, edit) {
    root.innerHTML = `<section class="hero page-hero video-hero"><div><div class="eyebrow"><span class="eyebrow-mark">${edit ? '✂' : '▶'}</span> VIDEO WORKSPACE / ${edit ? '05' : '04'}</div><h1>${edit ? 'Shape your footage. ' : 'Make video files. '}<span class="hero-gradient">${edit ? 'Keep your rhythm.' : 'Keep your quality.'}</span></h1><p>${edit ? 'Trim, adjust speed, rotate, flip, and fine-tune picture and sound with controls that stay easy to find.' : 'Convert supported video and audio formats locally in your browser, with options for resolution and quality.'}</p><div class="hero-tags"><span>Browser-based workflow</span><span>Quality controls</span><span>${edit ? 'Quick edits' : 'Multiple formats'}</span></div></div><div class="hero-mini-art video-mini" aria-hidden="true"><div class="video-window"><div><i></i><i></i><i></i></div><span>${edit ? 'EDIT' : 'EXPORT'}</span><b>▶</b><small>VIDEO STUDIO</small></div></div></section>
    <div class="vtool"><aside class="panel"><h2 class="panel-title">${edit ? 'Edit settings' : 'Conversion settings'}</h2>
    <button type="button" class="btn btn-primary" data-a="pick">Choose videos</button><input type="file" accept="video/*,audio/*" multiple hidden data-a="file">
    ${fld('Output format', sel('fmt', OUT))}
    ${fld('Resolution', sel('res', [['0', 'Original'], ['2160', '4K (2160p)'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p'], ['480', '480p']]))}
    ${fld('Quality', sel('crf', [['16', 'Maximum'], ['20', 'High'], ['24', 'Balanced'], ['30', 'Small file']]))}
    ${edit ? `${fld('Trim start (seconds)', '<input type="number" id="ts" min="0" step="0.1" value="0">')}${fld('Trim end (seconds, 0 = end)', '<input type="number" id="te" min="0" step="0.1" value="0">')}
    ${fld('Speed', sel('sp', [['1', 'Normal'], ['0.5', '0.5x'], ['0.75', '0.75x'], ['1.5', '1.5x'], ['2', '2x'], ['4', '4x']]))}
    ${fld('Rotate / flip', sel('rot', [['', 'None'], ['transpose=1', 'Rotate 90° right'], ['transpose=2', 'Rotate 90° left'], ['hflip,vflip', 'Rotate 180°'], ['hflip', 'Flip horizontal'], ['vflip', 'Flip vertical']]))}
    ${fld('Brightness (-0.5 to 0.5)', '<input type="range" id="br" min="-0.5" max="0.5" step="0.05" value="0">')}${fld('Contrast (0.5 to 2)', '<input type="range" id="co" min="0.5" max="2" step="0.05" value="1">')}${fld('Saturation (0 to 3)', '<input type="range" id="sa" min="0" max="3" step="0.1" value="1">')}
    ${fld('Volume (%)', '<input type="range" id="vol" min="0" max="300" value="100">')}
    <label class="switch"><input type="checkbox" id="mute"><span>Remove audio</span></label>
    <label class="switch"><input type="checkbox" id="fade"><span>Fade in and out (1 s)</span></label>` : ''}
    <button type="button" class="btn btn-primary" data-a="go" disabled>${edit ? 'Apply edits' : 'Convert'}</button></aside>
    <div class="vbody"><video controls hidden></video><p class="note" data-a="log">Choose one or more videos to begin.</p><ul class="queue" data-a="out"></ul></div></div>`;
    const $ = (s) => root.querySelector(s), g = (id) => root.querySelector('#' + id), A = (a) => root.querySelector(`[data-a="${a}"]`);
    let files = [];
    const log = (t) => (A('log').textContent = t);
    A('pick').onclick = () => A('file').click();
    A('file').onchange = (e) => { files = [...e.target.files]; A('go').disabled = !files.length; if (files.length) { const v = $('video'); v.hidden = false; v.src = URL.createObjectURL(files[0]); log(`${files.length} file${files.length > 1 ? 's' : ''} ready.`); } };
    A('go').onclick = async () => {
      const btn = A('go'); btn.disabled = true; A('out').replaceChildren();
      try {
        const f = await engine(log), fmt = g('fmt').value, audio = fmt === 'mp3' || fmt === 'wav';
        let pr = (e) => log(`Working… ${Math.round(e.progress * 100)}%`); f.on('progress', pr);
        for (const [i, file] of files.entries()) {
          log(`Processing ${i + 1} of ${files.length}: ${file.name}`);
          const inN = 'in' + i + '.' + (file.name.split('.').pop() || 'mp4'), outN = 'out' + i + '.' + fmt;
          await f.writeFile(inN, new Uint8Array(await file.arrayBuffer()));
          const a = [], vf = [], af = [], r = +g('res').value, dur = $('video').duration || 0;
          if (edit) { if (+g('ts').value > 0) a.push('-ss', g('ts').value); if (+g('te').value > 0) a.push('-to', g('te').value); }
          a.push('-i', inN);
          if (edit) {
            if (g('rot').value) vf.push(g('rot').value);
            vf.push(`eq=brightness=${g('br').value}:contrast=${g('co').value}:saturation=${g('sa').value}`);
            const sp = +g('sp').value; if (sp !== 1) { vf.push(`setpts=PTS/${sp}`); af.push(...(sp === 4 ? ['atempo=2', 'atempo=2'] : [`atempo=${sp}`])); }
            if (+g('vol').value !== 100) af.push(`volume=${g('vol').value / 100}`);
            if (g('fade').checked && dur > 2) { vf.push(`fade=t=in:d=1,fade=t=out:st=${Math.max(0, dur - 1)}:d=1`); af.push(`afade=t=in:d=1`); }
          }
          if (r) vf.push(`scale=-2:${r}:flags=lanczos`);
          const mute = edit && g('mute').checked;
          if (audio) a.push('-vn', ...(af.length ? ['-af', af.join(',')] : []), ...(fmt === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '0'] : []));
          else if (fmt === 'gif') a.push('-an', '-vf', [...vf, 'fps=15', 'scale=\'min(720,iw)\':-2:flags=lanczos', 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'].join(','));
          else {
            if (vf.length) a.push('-vf', vf.join(','));
            a.push(...(fmt === 'webm' ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(+g('crf').value + 6), '-deadline', 'realtime', '-cpu-used', '8'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', g('crf').value, '-pix_fmt', 'yuv420p']));
            if (mute) a.push('-an'); else a.push(...(af.length ? ['-af', af.join(',')] : []), ...(fmt === 'webm' ? ['-c:a', 'libopus'] : ['-c:a', 'aac', '-b:a', '256k']));
            if (fmt === 'mp4' || fmt === 'mov') a.push('-movflags', '+faststart');
          }
          if (await f.exec([...a, outN]) !== 0) { SB.toast(`${file.name} could not be processed.`); continue; }
          const data = await f.readFile(outN), blob = new Blob([data.buffer], { type: audio ? 'audio/' + fmt : fmt === 'gif' ? 'image/gif' : 'video/' + fmt });
          await f.deleteFile(inN); await f.deleteFile(outN);
          const li = document.createElement('li'), l = document.createElement('a'); li.className = 'item'; l.className = 'dl-link';
          l.href = URL.createObjectURL(blob); l.download = file.name.replace(/\.[^.]+$/, '') + '-shaban.' + fmt; l.textContent = `Download ${l.download} (${SB.fmtBytes(blob.size)})`;
          li.append(l); A('out').append(li);
        }
        f.off('progress', pr); log('Finished.');
      } catch (e) { log(e.message || 'Something went wrong.'); }
      btn.disabled = false;
    };
  }

  function mountDownloader(root) {
    const getApiBase = () => window.SHABAN_CONFIG?.getApiBase?.() ?? String(window.SHABAN_CONFIG?.API_BASE || '').replace(/\/$/, '');
    const apiUrl = (path) => `${getApiBase()}${path}`;
    root.innerHTML = `<section class="hero page-hero video-hero"><div><div class="eyebrow"><span class="eyebrow-mark">↓</span> VIDEO WORKSPACE / 06</div><h1>Bring your links. <span class="hero-gradient">Save what you can.</span></h1><p>Download supported public video links through the server, or direct video files when the source permits browser access. Only save content you own or have permission to use.</p><div class="hero-tags"><span>Supported video pages</span><span>Quality options</span><span>Progress tracking</span></div></div><div class="hero-mini-art video-mini" aria-hidden="true"><div class="video-window"><div><i></i><i></i><i></i></div><span>DOWNLOAD</span><b>↓</b><small>LINK WORKSPACE</small></div></div></section>
    <div class="vtool"><aside class="panel"><h2 class="panel-title">Download settings</h2>
    <div class="field"><label for="dlUrl">Video link</label><input type="url" id="dlUrl" placeholder="https://" autocomplete="url" spellcheck="false"></div>
    ${fld('Quality', sel('dlQ', [['best', 'Best available'], ['2160', 'Up to 4K'], ['1440', 'Up to 1440p'], ['1080', 'Up to 1080p'], ['720', 'Up to 720p'], ['audio', 'Audio only (MP3)']]))}
    <button type="button" class="btn btn-primary" id="dlGo">Download video</button>
    <button type="button" class="btn btn-outline" id="dlCheck">Check downloader server</button>
    <div class="field dl-connect-field"><label for="dlApiBase">Backend URL (optional)</label><input type="url" id="dlApiBase" placeholder="https://your-backend.example.com" spellcheck="false"><button type="button" class="btn btn-outline" id="dlSaveApiBase">Save backend URL</button><small class="note">Leave blank when the website and API use the same URL. For a separate backend, paste its HTTPS origin only.</small></div>
    <p class="note">For YouTube, Instagram, TikTok, Facebook and other video-page URLs, the downloader backend must be running. Direct file links may work without it if the source allows browser access.</p></aside>
    <div class="vbody"><p class="note" id="dlLog" role="status" aria-live="polite">Checking downloader server…</p><div class="dl-setup" id="dlSetup" hidden><strong>Downloader backend is not connected</strong><p>Video-page URLs such as YouTube, Instagram, TikTok, Facebook, Vimeo, and X need the server. A static website cannot extract them directly in the browser.</p><code>docker compose up --build -d</code><div class="dl-setup-actions"><button type="button" class="btn btn-outline" id="dlCopySetup">Copy setup command</button><a href="README.md" target="_blank" rel="noopener">Open setup guide ↗</a></div><small>For one live URL, deploy the complete project root with the root <code>Dockerfile</code> (website and API together). If using a separate static host, deploy <code>server/</code> separately and set <code>API_BASE</code> in <code>js/config.js</code>.</small></div><div id="dlDetails" hidden><strong id="dlTitle"></strong><p class="note" id="dlMeta"></p><img id="dlThumb" alt="Video thumbnail" hidden style="max-width:320px;width:100%;height:auto;border-radius:12px"></div><div id="dlReadyWrap" hidden><a id="dlReady" class="btn btn-primary dl-link" href="#">Download file manually</a><p class="note">Use this link if your browser did not start the file transfer automatically.</p></div></div></div>`;

    const $ = (s) => root.querySelector(s);
    const log = (text) => { $('#dlLog').textContent = text; };
    let backendAvailable = false;
    let checking = null;
    $('#dlApiBase').value = getApiBase();
    $('#dlSaveApiBase').addEventListener('click', () => {
      try {
        const saved = window.SHABAN_CONFIG?.setApiBase?.($('#dlApiBase').value);
        if (saved === undefined) throw new Error('Backend settings are unavailable. Refresh the page and try again.');
        $('#dlApiBase').value = saved;
        log(saved ? 'Backend URL saved in this browser. Checking connection…' : 'Backend URL cleared. Checking this website’s own API…');
      } catch (err) { log(err.message || 'Could not save the backend URL.'); }
    });
    window.addEventListener('shaban:api-base-change', () => {
      backendAvailable = false;
      checking = null;
      void checkBackend(true);
    });

    async function apiJson(path, options = {}) {
      let response;
      try {
        response = await fetch(apiUrl(path), { cache: 'no-store', ...options });
      } catch (err) {
        const reason = getApiBase()
          ? 'Could not reach the configured downloader server. Check API_BASE, the backend deployment, and its ALLOWED_ORIGIN setting.'
          : 'No downloader API was found at this website address.';
        throw new Error(`${reason} ${err?.message || ''}`.trim());
      }
      const contentType = response.headers.get('content-type') || '';
      let body;
      if (contentType.includes('application/json')) {
        body = await response.json().catch(() => ({}));
      } else {
        body = await response.text().catch(() => '');
      }
      if (!response.ok) {
        const message = typeof body === 'object' ? body?.error : String(body || '').replace(/<[^>]*>/g, ' ').trim();
        throw new Error(message || `Downloader server returned HTTP ${response.status}.`);
      }
      if (!body || typeof body !== 'object') throw new Error('The API response was not valid JSON. Check that API_BASE points to the downloader server, not the website.');
      return body;
    }

    async function checkBackend(showMessage = true) {
      if (checking) return checking;
      checking = (async () => {
        $('#dlCheck').disabled = true;
        try {
          const health = await apiJson('/api/health');
          if (!health.ok || !health.ytDlpReady) throw new Error(health.error || 'The backend is online but yt-dlp is not ready.');
          backendAvailable = true;
          if (showMessage) log(`Downloader connected · yt-dlp ${health.version || 'ready'} · ${health.activeJobs ?? 0} active job(s).`);
          return true;
        } catch (err) {
          backendAvailable = false;
          if (showMessage) {
            log(getApiBase()
              ? `Downloader server check failed: ${err.message}`
              : 'Downloader backend is offline. Direct media files may work, but video-page links need the backend. See setup steps below.');
            $('#dlSetup').hidden = false;
          }
          return false;
        } finally {
          $('#dlCheck').disabled = false;
          checking = null;
        }
      })();
      return checking;
    }

    function showInfo(info) {
      $('#dlDetails').hidden = false;
      $('#dlTitle').textContent = info.title || 'Video found';
      const parts = [];
      if (info.uploader) parts.push(info.uploader);
      if (Number.isFinite(info.duration) && info.duration > 0) {
        const seconds = Math.round(info.duration);
        parts.push(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      }
      $('#dlMeta').textContent = parts.join(' · ');
      if (info.thumbnail && /^https:\/\//i.test(info.thumbnail)) {
        $('#dlThumb').src = info.thumbnail;
        $('#dlThumb').hidden = false;
      } else {
        $('#dlThumb').removeAttribute('src');
        $('#dlThumb').hidden = true;
      }
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isPlatformPage = (rawUrl) => {
      try {
        const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
        return /(^|\.)((youtube\.com)|(youtu\.be)|(instagram\.com)|(tiktok\.com)|(facebook\.com)|(fb\.watch)|(vimeo\.com)|(x\.com)|(twitter\.com)|(dailymotion\.com)|(twitch\.tv)|(reddit\.com)|(pinterest\.com))$/.test(host);
      } catch { return false; }
    };

    async function downloadThroughServer(url, quality) {
      log('Checking the video link…');
      const info = await apiJson(`/api/info?url=${encodeURIComponent(url)}`);
      showInfo(info);
      log(`Video found: ${info.title || 'Video'}. Preparing the download…`);
      const started = await apiJson('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, q: quality, title: info.title || 'Video' })
      });
      if (!started.id) throw new Error('The server did not return a download job ID. Update the backend files and redeploy the server.');

      const maxWaitMs = 60 * 60 * 1000;
      const began = Date.now();
      let lastMessage = '';
      while (Date.now() - began < maxWaitMs) {
        await sleep(1100);
        const job = await apiJson(`/api/downloads/${encodeURIComponent(started.id)}`);
        if (job.status === 'error') throw new Error(job.error || 'The downloader could not create this file.');
        if (job.message && job.message !== lastMessage && (job.progress < 1 || job.progress >= 1)) lastMessage = job.message;
        if (job.status === 'ready') {
          log(`Download ready${job.size ? ` · ${SB.fmtBytes(job.size)}` : ''}. Starting file transfer…`);
          const a = document.createElement('a');
          a.href = apiUrl(`/api/downloads/${encodeURIComponent(started.id)}/file`);
          a.rel = 'noopener';
          a.style.display = 'none';
          $('#dlReady').href = a.href;
          $('#dlReadyWrap').hidden = false;
          document.body.append(a);
          a.click();
          setTimeout(() => a.remove(), 5000);
          log(`Your download is ready${job.size ? ` (${SB.fmtBytes(job.size)})` : ''}. If it did not save, check the browser's download permissions.`);
          return;
        }
        const pct = Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(99, Math.round(Number(job.progress)))) : 0;
        const elapsed = Math.round((Date.now() - began) / 1000);
        log(`${job.message || 'Preparing download'}${job.progress > 0 ? ` · ${pct}%` : ''}${elapsed > 8 ? ` · ${elapsed}s elapsed` : ''}`);
      }
      throw new Error('This download took more than 60 minutes and timed out in the page. Try lower quality or a shorter video.');
    }

    async function directFileDownload(url) {
      log('Trying a direct browser download…');
      let response;
      try { response = await fetch(url, { mode: 'cors', cache: 'no-store' }); }
      catch {
        throw new Error('The source blocks direct browser access (CORS). This works only for direct media-file URLs whose host permits cross-origin downloads. For YouTube or social-media page links, connect the downloader backend shown in the setup panel.');
      }
      if (!response.ok) throw new Error(`The source returned HTTP ${response.status}. The direct link may have expired or require sign-in.`);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      const pathName = new URL(url).pathname;
      if (/text\/html|application\/json|text\/plain/.test(type)) {
        throw new Error('That URL returned a web page, not a direct video file. Platform page links require the downloader backend.');
      }
      log('Receiving the video file…');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The source returned an empty file.');
      if (!/video\/|audio\/|application\/(?:octet-stream|mp4|x-mpegurl|vnd\.apple\.mpegurl)/.test(type) && !/\.(mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|ogg|ogv|mpeg|mpg|m3u8|ts)$/i.test(pathName)) {
        throw new Error('The response does not look like a video or audio file. Use a direct media-file URL or connect the downloader backend.');
      }
      const last = pathName.split('/').pop();
      let filename = 'video-download';
      try { if (last) filename = decodeURIComponent(last); } catch { if (last) filename = last; }
      filename = filename.replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').slice(0, 140) || 'video-download';
      SB.download(blob, filename);
      log(`Saved ${filename} · ${SB.fmtBytes(blob.size)}.`);
    }

    $('#dlCheck').addEventListener('click', () => { void checkBackend(true); });
    $('#dlCopySetup')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('docker compose up --build -d');
        log('Setup command copied. Run it inside the extracted website folder.');
      } catch {
        log('Copy is unavailable in this browser. Select the command shown above and copy it manually.');
      }
    });
    $('#dlGo').addEventListener('click', async () => {
      const url = $('#dlUrl').value.trim();
      const quality = $('#dlQ').value;
      if (!/^https?:\/\//i.test(url)) {
        log('Enter a complete video link that starts with http:// or https://.');
        $('#dlUrl').focus();
        return;
      }
      try { new URL(url); } catch { log('That link is not a valid URL.'); return; }
      $('#dlGo').disabled = true;
      $('#dlCheck').disabled = true;
      $('#dlDetails').hidden = true;
      $('#dlReadyWrap').hidden = true;
      $('#dlReady').removeAttribute('href');
      try {
        const online = backendAvailable || await checkBackend(false);
        if (online) {
          $('#dlSetup').hidden = true;
          await downloadThroughServer(url, quality);
        } else if (getApiBase()) {
          $('#dlSetup').hidden = false;
          throw new Error('The configured downloader backend is unreachable. Check API_BASE, the backend logs, and ALLOWED_ORIGIN.');
        } else if (isPlatformPage(url)) {
          $('#dlSetup').hidden = false;
          throw new Error('This is a video-page link, not a direct video file. The server is not connected, so the browser cannot download it. Use the setup panel to start or connect the backend.');
        } else {
          $('#dlSetup').hidden = true;
          await directFileDownload(url);
        }
      } catch (err) {
        log(err?.message || 'Download failed. Check the link and downloader server, then try again.');
        if (!backendAvailable && (getApiBase() || isPlatformPage(url))) $('#dlSetup').hidden = false;
      } finally {
        $('#dlGo').disabled = false;
        $('#dlCheck').disabled = false;
      }
    });

    // Probe automatically so the user sees whether the backend is truly ready.
    void checkBackend(true);
  }

  mount(document.getElementById('v-vconvert'), false);
  mount(document.getElementById('v-veditor'), true);
  mountDownloader(document.getElementById('v-vdownload'));
})();
