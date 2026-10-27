(() => {
  const $ = (s) => document.querySelector(s), SB = window.SB;
  const cv = $('#stCanvas'), cx = cv.getContext('2d');
  const FX = { fBr: 'brightness', fCo: 'contrast', fSa: 'saturate', fBl: 'blur', fHu: 'hue-rotate', fGr: 'grayscale' };
  let layers = [], act = null, tool = 'brush', n = 0, undo = [], redo = [], zoom = 0.65;
  const mk = (name, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return { id: ++n, name, c, x: 0, y: 0, s: 1, op: 100, bl: 'source-over', vis: true, fx: { fBr: 100, fCo: 100, fSa: 100, fBl: 0, fHu: 0, fGr: 0 } }; };
  const filt = (l) => Object.entries(FX).map(([k, f]) => `${f}(${l.fx[k]}${k === 'fBl' ? 'px' : k === 'fHu' ? 'deg' : '%'})`).join(' ');
  function render() {
    cx.clearRect(0, 0, cv.width, cv.height);
    for (const l of layers) {
      if (!l.vis) continue;
      cx.save(); cx.globalAlpha = l.op / 100; cx.globalCompositeOperation = l.bl; cx.filter = filt(l);
      cx.translate(l.x, l.y); cx.scale(l.s, l.s); cx.drawImage(l.c, 0, 0); cx.restore();
    }
  }
  function list() {
    const ul = $('#stLayers'); ul.replaceChildren();
    [...layers].reverse().forEach((l) => {
      const li = document.createElement('li'), s = document.createElement('span'), b = document.createElement('button');
      li.className = l === act ? 'on' : ''; s.textContent = l.name; b.textContent = l.vis ? 'Hide' : 'Show'; b.setAttribute('aria-label', 'Toggle visibility');
      b.onclick = (e) => { e.stopPropagation(); l.vis = !l.vis; list(); render(); };
      li.onclick = () => { act = l; list(); sync(); }; li.append(s, b); ul.append(li);
    });
  }
  function sync() {
    if (!act) return;
    $('#stOp').value = act.op; $('#stOpO').textContent = act.op; $('#stBlend').value = act.bl;
    for (const k in FX) { $('#' + k).value = act.fx[k]; $('#' + k + 'O').textContent = act.fx[k]; }
  }
  const snap = () => { undo.push(layers.map((l) => ({ ...l, fx: { ...l.fx }, c: Object.assign(document.createElement('canvas'), { width: l.c.width, height: l.c.height }) })).map((o, i) => (o.c.getContext('2d').drawImage(layers[i].c, 0, 0), o))); if (undo.length > 20) undo.shift(); redo = []; };
  const restore = (s) => { layers = s; act = layers.find((l) => l.id === act?.id) || layers[layers.length - 1]; list(); sync(); render(); };
  const cur = () => layers.map((l) => ({ ...l, fx: { ...l.fx }, c: Object.assign(document.createElement('canvas'), { width: l.c.width, height: l.c.height }) }));
  function updateDocMeta() { $('#stDocMeta').textContent = `${cv.width} × ${cv.height} px · RGB canvas`; }
  function applyZoom() {
    cv.style.maxWidth = 'none';
    cv.style.width = `${Math.max(1, Math.round(cv.width * zoom))}px`;
    cv.style.height = `${Math.max(1, Math.round(cv.height * zoom))}px`;
    $('#stZoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  }
  function fitZoom() {
    const stage = document.querySelector('.st-stage');
    if (!stage || stage.clientWidth < 120 || !cv.width || !cv.height) return;
    zoom = Math.min(1, Math.max(.1, (stage.clientWidth - 48) / cv.width));
    applyZoom();
  }
  function newDoc() {
    const w = Math.min(8000, Math.max(16, +$('#stW').value || 1200)), h = Math.min(8000, Math.max(16, +$('#stH').value || 800));
    cv.width = w; cv.height = h; layers = []; undo = []; redo = [];
    const bg = mk('Background', w, h), g = bg.c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    layers.push(bg); act = bg; list(); sync(); render(); updateDocMeta(); requestAnimationFrame(fitZoom);
  }
  async function open(files) {
    snap();
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      try {
        const b = await createImageBitmap(f), k = Math.min(1, cv.width / b.width, cv.height / b.height), l = mk(f.name, b.width, b.height);
        l.c.getContext('2d').drawImage(b, 0, 0); l.s = k; l.x = (cv.width - b.width * k) / 2; l.y = (cv.height - b.height * k) / 2; layers.push(l); act = l;
      } catch { SB.toast(`${f.name} could not be opened.`); }
    }
    list(); sync(); render();
  }
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
  const local = (p) => ({ x: (p.x - act.x) / act.s, y: (p.y - act.y) / act.s });
  let d = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!act) return; const p = pos(e), c = $('#stColor').value, sz = +$('#stSize').value;
    if (tool === 'pick') { const px = cx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data; $('#stColor').value = '#' + [...px.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join(''); return; }
    if (tool === 'text') {
      const t = prompt('Type your text'); if (!t) return; snap();
      const l = local(p), g = act.c.getContext('2d'), f = $('#stFont').value.trim() || 'Manrope';
      const weight = $('#stFontWeight').value, style = $('#stFontStyle').value, align = $('#stTextAlign').value;
      const fontSpec = `${style === 'italic' ? 'italic ' : ''}${weight} ${sz * 2}px "${f}"`;
      loadFont(f).then(() => document.fonts.load(fontSpec)).catch(() => []).finally(() => { g.fillStyle = c; g.font = fontSpec; g.textAlign = align; g.textBaseline = 'top'; g.fillText(t, l.x, l.y); render(); }); return;
    }
    snap(); cv.setPointerCapture(e.pointerId); d = { p, l: local(p), ox: act.x, oy: act.y, snapImg: null };
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') { d.snapImg = Object.assign(document.createElement('canvas'), { width: act.c.width, height: act.c.height }); d.snapImg.getContext('2d').drawImage(act.c, 0, 0); }
    if (tool === 'brush' || tool === 'eraser') stroke(d.l, d.l);
  });
  function stroke(a, b) {
    const g = act.c.getContext('2d'); g.save(); g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    g.strokeStyle = $('#stColor').value; g.lineWidth = +$('#stSize').value; g.lineCap = g.lineJoin = 'round'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x + 0.01, b.y); g.stroke(); g.restore(); render();
  }
  cv.addEventListener('pointermove', (e) => {
    if (!d) return; const p = pos(e), l = local(p);
    if (tool === 'move') { act.x = d.ox + p.x - d.p.x; act.y = d.oy + p.y - d.p.y; }
    else if (tool === 'brush' || tool === 'eraser') { stroke(d.l, l); d.l = l; return; }
    else { const g = act.c.getContext('2d'); g.clearRect(0, 0, act.c.width, act.c.height); g.drawImage(d.snapImg, 0, 0); g.fillStyle = $('#stColor').value; g.strokeStyle = $('#stColor').value; g.lineWidth = +$('#stSize').value; g.lineCap = 'round'; const s = local(d.p); g.beginPath(); if (tool === 'rect') { g.rect(s.x, s.y, l.x - s.x, l.y - s.y); $('#stShapeStyle').value === 'fill' ? g.fill() : g.stroke(); } else if (tool === 'ellipse') { g.ellipse((s.x + l.x) / 2, (s.y + l.y) / 2, Math.abs(l.x - s.x) / 2, Math.abs(l.y - s.y) / 2, 0, 0, 7); $('#stShapeStyle').value === 'fill' ? g.fill() : g.stroke(); } else { g.moveTo(s.x, s.y); g.lineTo(l.x, l.y); g.stroke(); } }
    render();
  });
  cv.addEventListener('pointerup', () => (d = null));
  $('#stTools').addEventListener('click', (e) => { const b = e.target.closest('.tbtn'); if (!b) return; tool = b.dataset.t; document.querySelectorAll('.tbtn').forEach((x) => x.classList.toggle('on', x === b)); cv.style.cursor = tool === 'move' ? 'move' : 'crosshair'; });
  document.querySelector('[data-t="brush"]').classList.add('on');
  const fontLinks = new Map();
  const systemFonts = new Set(['Arial','Georgia','Impact','Courier New','Times New Roman','Verdana','Trebuchet MS','Tahoma','system-ui','Manrope']);
  function loadFont(name) {
    const family = (name || '').trim();
    if (!family || systemFonts.has(family)) return Promise.resolve();
    if (fontLinks.has(family)) return fontLinks.get(family);
    const promise = new Promise((resolve) => {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
      link.onload = () => resolve();
      link.onerror = () => { fontLinks.delete(family); SB.toast(`Could not load ${family}. A local fallback will be used.`); resolve(); };
      document.head.append(link);
    });
    fontLinks.set(family, promise);
    return promise;
  }
  $('#stFont').addEventListener('change', () => loadFont($('#stFont').value));
  $('#stZoomIn').onclick = () => { zoom = Math.min(3, zoom * 1.15); applyZoom(); };
  $('#stZoomOut').onclick = () => { zoom = Math.max(.1, zoom / 1.15); applyZoom(); };
  $('#stZoomFit').onclick = fitZoom;
  window.addEventListener('resize', () => { if (zoom < .8) fitZoom(); });
  window.addEventListener('view', (e) => { if (e.detail === 'studio') requestAnimationFrame(fitZoom); });
  const keys = { v: 'move', b: 'brush', e: 'eraser', t: 'text', u: 'rect', l: 'line', i: 'pick' };
  addEventListener('keydown', (e) => {
    if ($('#v-studio').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? $('#stRedo') : $('#stUndo')).click(); }
    else if (keys[e.key.toLowerCase()]) document.querySelector(`[data-t="${keys[e.key.toLowerCase()]}"]`).click();
  });
  $('#stUndo').onclick = () => { if (undo.length) { redo.push(cur().map((o, i) => (o.c.getContext('2d').drawImage(layers[i].c, 0, 0), o))); restore(undo.pop()); } };
  $('#stRedo').onclick = () => { if (redo.length) { undo.push(cur().map((o, i) => (o.c.getContext('2d').drawImage(layers[i].c, 0, 0), o))); restore(redo.pop()); } };
  $('#stNew').onclick = newDoc; $('#stOpen').onclick = () => $('#stFile').click();
  $('#stFile').onchange = (e) => { open([...e.target.files]); e.target.value = ''; };
  $('#v-studio').addEventListener('dragover', (e) => e.preventDefault());
  $('#v-studio').addEventListener('drop', (e) => { e.preventDefault(); open([...e.dataTransfer.files]); });
  $('#stAdd').onclick = () => { snap(); act = mk('Layer ' + (n + 1), cv.width, cv.height); layers.push(act); list(); sync(); };
  $('#stDup').onclick = () => { if (!act) return; snap(); const l = { ...act, id: ++n, name: act.name + ' copy', fx: { ...act.fx }, c: Object.assign(document.createElement('canvas'), { width: act.c.width, height: act.c.height }) }; l.c.getContext('2d').drawImage(act.c, 0, 0); layers.splice(layers.indexOf(act) + 1, 0, l); act = l; list(); render(); };
  $('#stDel').onclick = () => { if (layers.length < 2) return; snap(); layers.splice(layers.indexOf(act), 1); act = layers[layers.length - 1]; list(); sync(); render(); };
  const mv = (dir) => { const i = layers.indexOf(act), j = i + dir; if (j < 0 || j >= layers.length) return; snap(); [layers[i], layers[j]] = [layers[j], layers[i]]; list(); render(); };
  $('#stUp').onclick = () => mv(1); $('#stDn').onclick = () => mv(-1);
  $('#stSize').oninput = () => ($('#stSizeO').textContent = $('#stSize').value);
  $('#stQ').oninput = () => ($('#stQO').textContent = $('#stQ').value);
  $('#stOp').addEventListener('input', () => { if (act) { act.op = +$('#stOp').value; $('#stOpO').textContent = act.op; render(); } });
  $('#stBlend').onchange = () => { if (act) { act.bl = $('#stBlend').value; render(); } };
  Object.keys(FX).forEach((k) => $('#' + k).addEventListener('input', () => { if (act) { act.fx[k] = +$('#' + k).value; $('#' + k + 'O').textContent = act.fx[k]; render(); } }));
  $('#stExport').onclick = async () => {
    const f = $('#stFmt').value, out = document.createElement('canvas'); out.width = cv.width; out.height = cv.height;
    const g = out.getContext('2d'); if (f === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height); } g.drawImage(cv, 0, 0);
    const b = await new Promise((r) => out.toBlob(r, f, f === 'image/png' ? undefined : $('#stQ').value / 100));
    if (!b || b.type !== f) return SB.toast('This browser cannot create that format. Choose another.');
    SB.download(b, 'design-by-shaban.' + { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' }[f]);
  };
  newDoc();
  $('#footerYear') && ($('#footerYear').textContent = new Date().getFullYear());
})();
