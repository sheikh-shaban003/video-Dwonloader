(() => {
  'use strict';
  const root = document.getElementById('v-imagegen');
  if (!root) return;
  const getApiBase = () => window.SHABAN_CONFIG?.getApiBase?.() ?? String(window.SHABAN_CONFIG?.API_BASE || '').replace(/\/$/, '');
  const apiUrl = (path) => `${getApiBase()}${path}`;
  const $ = (id) => document.getElementById(id);
  let mode = 'generate';
  let sourceFile = null;
  let resultDataUrl = '';
  let resultPrompt = '';
  let resultOptions = {};
  let sourcePreviewUrl = '';

  const setStatus = (message, state = 'info') => {
    const target = $('igApiStatus');
    target.dataset.state = state;
    target.querySelector('span:nth-child(2)').textContent = message;
  };
  const showError = (message) => {
    $('igError').textContent = message;
    $('igError').hidden = false;
  };
  const clearError = () => { $('igError').hidden = true; $('igError').textContent = ''; };

  function routeNotFoundMessage(path, status = 404) {
    const backendUrl = getApiBase() ? ' Double-check API_BASE in js/config.js: use the backend origin only, without a trailing /api.' : '';
    return `The image API route ${path} was not found (HTTP ${status}). This usually means only the static website was deployed, without its server-side image functions. For Netlify, deploy the complete project from Git or the Netlify CLI so netlify/functions is included, add OPENAI_API_KEY under Site configuration → Environment variables, then redeploy. For other hosting, deploy the supplied server/Docker backend and set API_BASE in js/config.js.${backendUrl}`;
  }

  async function responseError(response, path) {
    const contentType = response.headers.get('content-type') || '';
    let raw = '';
    if (contentType.includes('application/json')) {
      const data = await response.json().catch(() => ({}));
      const message = data.error || data.message || `Server returned HTTP ${response.status}.`;
      if (/page not found|:root\s*\{|colorRgbFacets/i.test(String(message))) return routeNotFoundMessage(path, response.status);
      return message;
    }
    raw = await response.text().catch(() => '');
    // Static hosts often return their full HTML/CSS 404 document for missing /api routes.
    // Never display that markup (especially :root CSS declarations) as an application error.
    const appearsLikeHosting404 = response.status === 404 || /page not found|<!doctype html|<html|:root\s*\{|colorRgbFacets/i.test(raw);
    if (appearsLikeHosting404) return routeNotFoundMessage(path, response.status);
    const clean = raw.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.slice(0, 450) || `Server returned HTTP ${response.status}.`;
  }

  async function apiRequest(path, options = {}) {
    let response;
    try {
      response = await fetch(apiUrl(path), { cache: 'no-store', ...options });
    } catch {
      throw new Error(getApiBase()
        ? 'Cannot reach the configured backend. Check API_BASE, server uptime, HTTPS, and ALLOWED_ORIGIN.'
        : 'Cannot reach the image API. If this is a hosted static website, deploy the included Netlify Functions and set OPENAI_API_KEY, or deploy the server/Docker backend and set API_BASE in js/config.js.');
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      if (!response.ok || /text\/html/i.test(type)) throw new Error(await responseError(response, path));
      throw new Error(`The image API returned an unexpected response type (${type || 'unknown'}). Check the backend route and deployment logs.`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Server returned HTTP ${response.status}.`);
    return data;
  }

  async function checkService() {
    $('igCheckService').disabled = true;
    setStatus('Checking image service…', 'loading');
    try {
      const health = await apiRequest('/api/images/health');
      if (!health.configured) {
        setStatus('Backend online · OpenAI API key missing', 'warning');
        $('igApiStatus').title = health.message || 'Set OPENAI_API_KEY on the server.';
        showError(health.message || 'Add OPENAI_API_KEY to the backend environment and restart the server.');
        return false;
      }
      clearError();
      setStatus('API key configured · GPT-6 Astra', 'ready');
      $('igApiStatus').title = `Model: ${health.orchestrationModel || 'gpt-6-astra'}. API access is confirmed by the first generation request.`;
      return true;
    } catch (err) {
      setStatus('Image service offline', 'error');
      showError(err.message);
      return false;
    } finally {
      $('igCheckService').disabled = false;
    }
  }

  function setMode(nextMode) {
    mode = nextMode === 'edit' ? 'edit' : 'generate';
    $('igModeGenerate').classList.toggle('active', mode === 'generate');
    $('igModeEdit').classList.toggle('active', mode === 'edit');
    $('igModeGenerate').setAttribute('aria-pressed', String(mode === 'generate'));
    $('igModeEdit').setAttribute('aria-pressed', String(mode === 'edit'));
    $('igGenerateBtn').innerHTML = mode === 'edit' ? '<span>✎</span> Edit image with AI' : '<span>✦</span> Generate image';
    $('igSourceNote').textContent = mode === 'edit'
      ? 'Choose a reference image, or use the current generated result as your next edit.'
      : 'Choose Edit image to make changes to an uploaded reference. You can also generate without a reference.';
    $('igPrompt').placeholder = mode === 'edit'
      ? 'Example: keep the product shape, label, and camera angle unchanged; replace the background with a bright ivory studio, add soft window light and realistic shadows…'
      : 'Example: premium skincare product photography, frosted glass serum bottle on a warm ivory pedestal, soft daylight, subtle shadows, editorial art direction, no extra text…';
    clearError();
  }

  function previewSource(file) {
    sourceFile = file || null;
    if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
    sourcePreviewUrl = '';
    if (!sourceFile) {
      $('igSourcePreview').hidden = true;
      $('igSourceThumb').removeAttribute('src');
      $('igSourceName').textContent = '';
      $('igSource').value = '';
      return;
    }
    sourcePreviewUrl = URL.createObjectURL(sourceFile);
    $('igSourceThumb').src = sourcePreviewUrl;
    $('igSourceName').textContent = sourceFile.name;
    $('igSourcePreview').hidden = false;
    if (mode !== 'edit') setMode('edit');
  }

  function startBusy(editing) {
    clearError();
    $('igEmpty').hidden = true;
    $('igResultImage').hidden = true;
    $('igBusy').hidden = false;
    $('igBusyTitle').textContent = editing ? 'Refining your image…' : 'Creating your image…';
    $('igBusyText').textContent = editing ? 'Applying your instructions while preserving the reference' : 'Rendering details, light, materials, and composition';
    $('igResultBadge').textContent = 'WORKING';
    $('igResultBadge').dataset.state = 'working';
    $('igGenerateBtn').disabled = true;
    $('igGenerateBtn').classList.add('is-working');
    $('igOutputActions').hidden = true;
    $('igMeta').hidden = true;
  }

  function endBusy(success) {
    $('igBusy').hidden = true;
    $('igGenerateBtn').disabled = false;
    $('igGenerateBtn').classList.remove('is-working');
    $('igResultBadge').textContent = success ? 'COMPLETE' : 'READY';
    $('igResultBadge').dataset.state = success ? 'ready' : 'idle';
  }

  function setImageResult(data, prompt, options) {
    resultDataUrl = data.imageDataUrl;
    resultPrompt = prompt;
    resultOptions = { ...options, model: data.model || options.model, orchestrationModel: data.orchestrationModel || 'gpt-6-astra' };
    $('igResultImage').src = resultDataUrl;
    $('igResultImage').hidden = false;
    $('igEmpty').hidden = true;
    $('igResultTitle').textContent = 'Image ready to refine';
    $('igOutputActions').hidden = false;
    $('igMeta').hidden = false;
    $('igPsdSettings').hidden = false;
    $('igDimensions').textContent = options.size === 'auto' ? 'Automatic size' : options.size.replace('x', ' × ') + ' px';
    $('igModelUsed').textContent = `${data.model || options.model} · ${options.quality}`;
    $('igDownloadPng').textContent = `Download ${extensionFor(data.format || options.format).toUpperCase()}`;
    $('igResultImage').onload = () => {
      $('igDimensions').textContent = `${$('igResultImage').naturalWidth} × ${$('igResultImage').naturalHeight} px`;
    };
    endBusy(true);
    clearError();
    setStatus('Image service connected · ready to create', 'ready');
  }

  function extensionFor(format) { return format === 'jpeg' ? 'jpg' : (format || 'png'); }
  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function dataUrlToBlob(dataUrl) {
    const [head, encoded] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [,'image/png'])[1];
    const raw = atob(encoded || '');
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  async function imageAsPngBlob() {
    if (!resultDataUrl) throw new Error('Generate an image first.');
    const img = new Image();
    img.src = resultDataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not prepare PNG for export.')), 'image/png'));
    return { blob, width: canvas.width, height: canvas.height };
  }

  function usingSameOriginServerless() {
    const host = String(location.hostname || '').toLowerCase();
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return !getApiBase() && !local;
  }

  async function compressReferenceForServerless(file) {
    // Netlify buffered functions have a request payload limit. Keep reference-image uploads
    // below ~3.3 MB (with multipart overhead) while preserving transparency via WEBP.
    const byteLimit = 3.3 * 1024 * 1024;
    if (!usingSameOriginServerless() || file.size <= byteLimit) return file;
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      let scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
      for (let dimensionAttempt = 0; dimensionAttempt < 6; dimensionAttempt++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Your browser could not prepare the reference image. Try a smaller PNG, JPG, or WEBP file.');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.9, 0.84, 0.78, 0.7, 0.62]) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
          if (blob && blob.type === 'image/webp' && blob.size <= byteLimit) {
            return new File([blob], 'shaban-reference.webp', { type: 'image/webp', lastModified: Date.now() });
          }
        }
        scale *= 0.78;
      }
      throw new Error('This reference image is too large for the hosted image function. Try a smaller image, or connect the Docker backend for larger uploads.');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function generateOrEdit() {
    const prompt = $('igPrompt').value.trim();
    if (!prompt) { showError('Write a prompt describing what you want to create or change.'); $('igPrompt').focus(); return; }
    if (prompt.length > 12000) { showError('Keep the prompt under 12,000 characters.'); return; }
    let fileForEdit = sourceFile;
    if (mode === 'edit' && !fileForEdit && resultDataUrl) {
      const blob = dataUrlToBlob(resultDataUrl);
      fileForEdit = new File([blob], `shaban-generated-reference.${extensionFor(resultOptions.format || 'png')}`, { type: blob.type || 'image/png' });
    }
    if (mode === 'edit' && !fileForEdit) {
      showError('Choose an image or generate an image first, then click Edit this result.');
      return;
    }
    const options = {
      model: $('igModel').value,
      quality: $('igQuality').value,
      size: $('igSize').value,
      background: $('igBackground').value,
      format: $('igFormat').value
    };
    if (options.background === 'transparent' && options.format === 'jpeg') {
      options.background = 'opaque';
      $('igBackground').value = 'opaque';
    }
    startBusy(mode === 'edit');
    try {
      let data;
      if (mode === 'edit') {
        const form = new FormData();
        form.append('prompt', prompt);
        form.append('model', options.model);
        form.append('quality', options.quality);
        form.append('size', options.size);
        form.append('background', options.background);
        form.append('output_format', options.format);
        const uploadFile = await compressReferenceForServerless(fileForEdit);
        form.append('image', uploadFile, uploadFile.name || 'reference-image.png');
        data = await apiRequest('/api/images/edit', { method: 'POST', body: form });
      } else {
        data = await apiRequest('/api/images/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, model: options.model, quality: options.quality, size: options.size, background: options.background, output_format: options.format })
        });
      }
      if (!data || !data.imageDataUrl) throw new Error('The server did not return image data. Check the backend logs and retry.');
      setImageResult(data, prompt, options);
    } catch (err) {
      endBusy(false);
      $('igResultBadge').textContent = 'NOT COMPLETE';
      showError(err.message || 'Image generation failed.');
      setStatus('Image request failed', 'error');
    }
  }

  function colorToRgb(hex) {
    const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'ffffff';
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }

  async function exportPsd() {
    if (!resultDataUrl) return;
    const button = $('igExportPsd');
    const prior = button.textContent;
    button.disabled = true;
    button.textContent = 'Building PSD…';
    clearError();
    try {
      const { blob } = await imageAsPngBlob();
      const form = new FormData();
      form.append('image', blob, 'generated-artwork.png');
      form.append('caption', $('igPsdCaption').value.trim());
      form.append('fontSize', $('igPsdFontSize').value);
      form.append('color', $('igPsdColor').value);
      form.append('position', $('igPsdPosition').value);
      const response = await fetch(apiUrl('/api/images/psd'), { method: 'POST', body: form, cache: 'no-store' });
      if (!response.ok) {
        const message = await responseError(response, '/api/images/psd');
        throw new Error(message || 'PSD export failed.');
      }
      const psdBlob = await response.blob();
      triggerDownload(psdBlob, 'designing-by-shaban-editable.psd');
    } catch (err) {
      showError(err.message || 'Could not export PSD. Check that the backend is online and its PSD dependencies are installed.');
    } finally {
      button.disabled = false;
      button.textContent = prior;
    }
  }

  async function exportSvg() {
    if (!resultDataUrl) return;
    const { blob, width, height } = await imageAsPngBlob();
    const reader = new FileReader();
    const imagePngUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not prepare SVG image data.'));
      reader.readAsDataURL(blob);
    });
    const caption = $('igPsdCaption').value.trim();
    const size = Math.max(8, Math.min(300, Number($('igPsdFontSize').value) || 64));
    const rgb = colorToRgb($('igPsdColor').value);
    const color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    const y = $('igPsdPosition').value === 'top' ? Math.round(height * .12) : $('igPsdPosition').value === 'center' ? Math.round(height * .52) : Math.round(height * .86);
    const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Designing by Shaban editable image project</title><image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" xlink:href="${imagePngUrl}"/>${caption ? `<text x="${Math.round(width*.06)}" y="${y}" fill="${color}" font-family="Arial, sans-serif" font-size="${size}">${esc(caption)}</text>` : ''}</svg>`;
    triggerDownload(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'designing-by-shaban-editable.svg');
  }

  function saveProjectJson() {
    if (!resultDataUrl) return;
    const project = {
      app: 'Designing by Shaban AI Image Studio',
      version: 1,
      savedAt: new Date().toISOString(),
      prompt: resultPrompt,
      options: resultOptions,
      imageDataUrl: resultDataUrl,
      editableText: {
        text: $('igPsdCaption').value,
        fontSize: Number($('igPsdFontSize').value) || 64,
        color: $('igPsdColor').value,
        position: $('igPsdPosition').value
      },
      note: 'Open in this app or use the imageDataUrl and editableText values in an external workflow. The generated artwork is raster image data; overlay text is separately editable in SVG/PSD exports.'
    };
    triggerDownload(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), 'designing-by-shaban-image-project.json');
  }

  $('igModeGenerate').addEventListener('click', () => setMode('generate'));
  $('igModeEdit').addEventListener('click', () => setMode('edit'));
  $('igSource').addEventListener('change', (event) => previewSource(event.target.files?.[0] || null));
  $('igRemoveSource').addEventListener('click', () => previewSource(null));
  $('igGenerateBtn').addEventListener('click', () => void generateOrEdit());
  $('igCheckService').addEventListener('click', () => void checkService());
  $('igDownloadPng').addEventListener('click', () => {
    if (!resultDataUrl) return;
    triggerDownload(dataUrlToBlob(resultDataUrl), `shaban-ai-image.${extensionFor(resultOptions.format || 'png')}`);
  });
  $('igEditResult').addEventListener('click', () => {
    previewSource(null);
    setMode('edit');
    $('igPrompt').focus();
    if (!$('igPrompt').value.trim()) $('igPrompt').value = 'Refine this image while preserving the main subject, identity, framing, and overall quality. Improve lighting, details, and visual polish: ';
    $('igPrompt').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  $('igExportPsd').addEventListener('click', () => void exportPsd());
  $('igExportSvg').addEventListener('click', () => void exportSvg().catch((err) => showError(err.message)));
  $('igSaveProject').addEventListener('click', saveProjectJson);
  $('igFormat').addEventListener('change', () => {
    if ($('igFormat').value === 'jpeg' && $('igBackground').value === 'transparent') $('igBackground').value = 'opaque';
  });
  $('igPrompt').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void generateOrEdit(); }
  });
  $('igApiBase').value = getApiBase();
  $('igSaveApiBase').addEventListener('click', () => {
    try {
      const saved = window.SHABAN_CONFIG?.setApiBase?.($('igApiBase').value);
      if (saved === undefined) throw new Error('Backend settings are unavailable. Refresh the page and try again.');
      $('igApiBase').value = saved;
      clearError();
      setStatus('Backend URL saved · checking service…', 'loading');
    } catch (error) {
      showError(error.message || 'Could not save the backend URL.');
      setStatus('Invalid backend URL', 'error');
    }
  });
  window.addEventListener('shaban:api-base-change', (event) => {
    if ($('igApiBase')) $('igApiBase').value = event.detail?.apiBase ?? getApiBase();
    void checkService();
  });

  void checkService();
})();
