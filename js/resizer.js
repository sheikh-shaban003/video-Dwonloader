(() => {
  const $ = (s) => document.querySelector(s), SB = window.SB;
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };
  const cv = $('#rzCanvas'), cx = cv.getContext('2d'), items = []; let cur = null;
  const W = () => Math.min(16384, Math.max(16, +$('#rzW').value || 1080)), H = () => Math.min(16384, Math.max(16, +$('#rzH').value || 1080));
  const q = () => +$('#rzQ').value / 100;

  // Enlarge in gentle steps (much cleaner than one big jump), then optionally sharpen.
  function resample(img, tw) {
    let c = img, w = img.width;
    while (tw > w * 1.5) { const n = document.createElement('canvas'); n.width = Math.round(w * 1.5); n.height = Math.round(c.height * 1.5); const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, n.width, n.height); c = n; w = n.width; }
    return c;
  }
  function sharpen(ctx, w, h, amt) {
    const d = ctx.getImageData(0, 0, w, h), s = new Uint8ClampedArray(d.data), o = d.data, k = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let c = 0; c < 3; c++) {
      const i = (y * w + x) * 4 + c; let v = 0, j = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) v += s[i + (dy * w + dx) * 4] * k[j++];
      o[i] = s[i] + (v - s[i]) * amt;
    }
    ctx.putImageData(d, 0, 0);
  }
  function paint(ctx, w, h, it, enhance, scale) {
    ctx.clearRect(0, 0, w, h);
    if (!$('#rzTrans').checked || !/png|webp|avif/.test($('#rzFmt').value)) { ctx.fillStyle = $('#rzBg').value; ctx.fillRect(0, 0, w, h); }
    const iw = it.img.width, ih = it.img.height, f = $('#rzFit').value;
    let sx = Math.min(w / iw, h / ih), sy = sx;
    if (f === 'cover') sx = sy = Math.max(w / iw, h / ih); else if (f === 'stretch') { sx = w / iw; sy = h / ih; }
    sx *= it.z; sy *= it.z;
    const dw = iw * sx, dh = ih * sy, dx = (w - dw) / 2 + it.ox * w, dy = (h - dh) / 2 + it.oy * h;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(enhance ? resample(it.img, dw) : it.img, dx, dy, dw, dh);
    if (enhance && (sx > 1 || sy > 1)) sharpen(ctx, w, h, 0.5);
  }
  function updateZoomUI() {
    const pct = Math.round((cur?.z || 1) * 100);
    $('#rzZ').value = Math.max(10, Math.min(600, pct));
    $('#rzZO').textContent = pct + '%';
    $('#rzZoomReadout').textContent = pct + '%';
  }
  function draw() {
    const w = W(), h = H(), k = Math.min(1, 560 / Math.max(w, h));
    cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    if (cur) paint(cx, cv.width, cv.height, cur, false); else { cx.fillStyle = $('#rzBg').value; cx.fillRect(0, 0, cv.width, cv.height); }
    $('#rzExport').disabled = !items.length;
    $('#rzFrame').classList.toggle('has-image', !!cur);
    $('#rzCanvasLabel').textContent = `${w} × ${h} px`;
    updateZoomUI();
  }
  function setZoom(value) {
    if (!cur) return;
    cur.z = Math.min(6, Math.max(0.1, value));
    draw();
  }
  function resetCurrent() {
    if (!cur) return;
    cur.z = 1; cur.ox = 0; cur.oy = 0; draw();
  }
  function select(it) {
    cur = it;
    document.querySelectorAll('#rzList img').forEach((i) => i.classList.toggle('on', i.it === it));
    draw();
  }
  async function add(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const img = await createImageBitmap(f), it = { f, img, z: 1, ox: 0, oy: 0 };
        const t = document.createElement('img'); t.alt = f.name; t.title = f.name; t.it = it;
        t.src = URL.createObjectURL(f); t.onclick = () => select(it); $('#rzList').append(t);
        items.push(it); if (!cur) select(it);
      } catch { SB.toast(f.name + ' could not be read.'); }
    }
    $('#rzHint').hidden = !!items.length; draw();
  }
  $('#rzAdd').onclick = () => $('#rzFile').click();
  $('#rzFile').onchange = (e) => { add([...e.target.files]); e.target.value = ''; };
  $('#rzDrop').addEventListener('drop', (e) => { e.preventDefault(); add([...e.dataTransfer.files]); });
  $('#rzPreset').onchange = (e) => { if (e.target.value !== 'custom') { const [a, b] = e.target.value.split('x'); $('#rzW').value = a; $('#rzH').value = b; } draw(); };
  ['#rzW', '#rzH'].forEach((s) => $(s).addEventListener('input', () => { $('#rzPreset').value = 'custom'; draw(); }));
  ['#rzFit', '#rzBg', '#rzTrans', '#rzFmt'].forEach((s) => $(s).addEventListener('input', draw));
  $('#rzQ').oninput = () => ($('#rzQO').textContent = $('#rzQ').value);
  $('#rzZ').oninput = () => setZoom(+$('#rzZ').value / 100);
  $('#rzZoomIn').onclick = () => setZoom((cur?.z || 1) * 1.12);
  $('#rzZoomOut').onclick = () => setZoom((cur?.z || 1) / 1.12);
  $('#rzReset').onclick = resetCurrent;
  $('#rzAll').onclick = () => { if (cur) { items.forEach((i) => { i.z = cur.z; i.ox = cur.ox; i.oy = cur.oy; }); draw(); SB.toast('Frame and zoom applied to all images.'); } };
  cv.addEventListener('wheel', (e) => { if (!cur) return; e.preventDefault(); setZoom(cur.z * (e.deltaY < 0 ? 1.06 : 0.94)); }, { passive: false });
  let handleDrag = null;
  document.querySelectorAll('.rz-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (!cur) return;
      e.preventDefault(); e.stopPropagation();
      const rect = cv.getBoundingClientRect();
      handleDrag = { handle, x: e.clientX, y: e.clientY, z: cur.z, rect, key: handle.dataset.handle };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!handleDrag || handleDrag.handle !== handle || !cur) return;
      const { x, y, z, rect, key } = handleDrag;
      const dx = e.clientX - x, dy = e.clientY - y;
      const outwardX = key.includes('e') ? 1 : key.includes('w') ? -1 : 0;
      const outwardY = key.includes('s') ? 1 : key.includes('n') ? -1 : 0;
      const distance = (dx * outwardX + dy * outwardY) / Math.max(120, Math.max(rect.width, rect.height));
      setZoom(z * Math.max(0.12, 1 + distance * 2));
    });
    const done = () => { handleDrag = null; };
    handle.addEventListener('pointerup', done);
    handle.addEventListener('pointercancel', done);
    handle.addEventListener('lostpointercapture', done);
  });
  let drag = null;
  cv.addEventListener('pointerdown', (e) => { if (cur) { drag = { x: e.clientX, y: e.clientY, ox: cur.ox, oy: cur.oy }; cv.setPointerCapture(e.pointerId); } });
  cv.addEventListener('pointermove', (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); cur.ox = drag.ox + (e.clientX - drag.x) / r.width; cur.oy = drag.oy + (e.clientY - drag.y) / r.height; draw(); });
  cv.addEventListener('pointerup', () => (drag = null));

  $('#rzExport').onclick = async () => {
    const fmt = $('#rzFmt').value, w = W(), h = H(), out = [], btn = $('#rzExport');
    btn.disabled = true;
    for (let n = 0; n < items.length; n++) {
      btn.textContent = `Exporting ${n + 1} of ${items.length}…`; await new Promise((r) => setTimeout(r, 20));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h, items[n], $('#rzEnh').checked);
      const b = await new Promise((r) => c.toBlob(r, fmt, fmt === 'image/png' ? undefined : q()));
      if (!b || b.type !== fmt) { SB.toast('This browser cannot create that format. Choose another.'); break; }
      out.push({ b, name: items[n].f.name.replace(/\.[^.]+$/, '') + `-${w}x${h}.${EXT[fmt]}` });
    }
    if (out.length === 1) SB.download(out[0].b, out[0].name);
    else if (out.length) { const z = new JSZip(); out.forEach((o) => z.file(o.name, o.b)); SB.download(await z.generateAsync({ type: 'blob', compression: 'STORE' }), 'resized-images.zip'); }
    btn.textContent = 'Export all'; btn.disabled = false;
    if (out.length) SB.toast('Export complete.');
  };
  draw();
})();
