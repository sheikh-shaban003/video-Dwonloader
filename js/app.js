(() => {
  'use strict';

  /* ---------- Config ---------- */
  const FORMATS = {
    'image/webp': { ext: 'webp', label: 'WEBP', lossy: true,  hint: 'Small files with transparency support.' },
    'image/jpeg': { ext: 'jpg',  label: 'JPG',  lossy: true,  hint: 'Best for photographs. No transparency.' },
    'image/png':  { ext: 'png',  label: 'PNG',  lossy: false, hint: 'Lossless with transparency. Larger files.' },
    'image/avif': { ext: 'avif', label: 'AVIF', lossy: true,  hint: 'Smallest files. Not every browser can create AVIF.' }
  };
  const IMG_EXT = /\.(png|jpe?g|jfif|webp|gif|bmp|avif|svg|ico)$/i;
  const MAX_SIDE = 16384;

  /* ---------- Elements ---------- */
  const $ = (s) => document.querySelector(s);
  const els = {
    drop: $('#drop'),
    fileInput: $('#fileInput'),
    folderInput: $('#folderInput'),
    pickFiles: $('#pickFiles'),
    pickFolder: $('#pickFolder'),
    formatSeg: $('#formatSeg'),
    formatHint: $('#formatHint'),
    avifLabel: $('#avifLabel'),
    qualityField: $('#qualityField'),
    quality: $('#quality'),
    qualityOut: $('#qualityOut'),
    maxDim: $('#maxDim'),
    bgField: $('#bgField'),
    bg: $('#bg'),
    keepFolders: $('#keepFolders'),
    results: $('#results'),
    statsMain: $('#statsMain'),
    statsSub: $('#statsSub'),
    convertBtn: $('#convertBtn'),
    zipBtn: $('#zipBtn'),
    clearBtn: $('#clearBtn'),
    progress: $('#progress'),
    progressBar: $('#progressBar'),
    queue: $('#queue'),
    toast: $('#toast')
  };

  const state = {
    items: [],
    format: 'image/webp',
    quality: 0.9,
    maxDim: 0,
    bg: '#ffffff',
    keepFolders: true,
    busy: false
  };
  let uid = 0;

  /* ---------- Helpers ---------- */
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    const units = ['KB', 'MB', 'GB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return n.toFixed(n >= 100 ? 0 : 1) + ' ' + units[i];
  }

  function isImage(file) {
    return (file.type && file.type.startsWith('image/')) || IMG_EXT.test(file.name);
  }

  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200);
  }

  function download(blob, name) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- Adding files ---------- */
  function addFiles(list) {
    const seen = new Set(state.items.map((i) => i.key));
    let added = 0, skipped = 0;

    for (const { file, path } of list) {
      if (!isImage(file)) { skipped++; continue; }
      const key = `${path}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const slash = path.lastIndexOf('/');
      const item = {
        id: ++uid,
        key,
        file,
        path,
        dir: slash >= 0 ? path.slice(0, slash + 1) : '',
        thumb: URL.createObjectURL(file),
        status: 'ready',
        out: null,
        outName: '',
        error: ''
      };
      state.items.push(item);
      els.queue.append(createRow(item));
      added++;
    }

    update();
    if (added) toast(`${added} image${added === 1 ? '' : 's'} added.`);
    else if (skipped) toast('No supported images were found in that selection.');
  }

  async function readEntry(entry, base = '') {
    if (entry.isFile) {
      return new Promise((res) =>
        entry.file((f) => res([{ file: f, path: base + f.name }]), () => res([]))
      );
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        all.push(...batch);
      } while (batch.length);
      const nested = await Promise.all(all.map((e) => readEntry(e, base + entry.name + '/')));
      return nested.flat();
    }
    return [];
  }

  /* ---------- Rows ---------- */
  function createRow(it) {
    const li = document.createElement('li');
    li.className = 'item';
    li.dataset.id = it.id;
    li.innerHTML = `
      <img class="thumb" alt="" loading="lazy" decoding="async">
      <div class="meta">
        <p class="name"></p>
        <p class="path"></p>
        <p class="sizes"></p>
      </div>
      <div class="state">
        <span class="pill"></span>
        <button type="button" class="icon-btn dl" aria-label="Download converted image" title="Download">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5v9M5.2 8 9 11.8 12.8 8M3 14.5h12"/></svg>
        </button>
        <button type="button" class="icon-btn rm" aria-label="Remove from list" title="Remove">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9"/></svg>
        </button>
      </div>`;
    li.querySelector('.thumb').src = it.thumb;
    li.querySelector('.name').textContent = it.file.name;
    li.querySelector('.path').textContent = it.dir ? it.dir : 'Single file';
    paintRow(li, it);
    return li;
  }

  function paintRow(li, it) {
    li.dataset.status = it.status;
    const pill = { ready: 'Ready', working: 'Converting', done: 'Done', error: 'Failed' }[it.status];
    li.querySelector('.pill').textContent = pill;
    const sizes = li.querySelector('.sizes');
    sizes.className = 'sizes';

    if (it.status === 'done') {
      const delta = Math.round((1 - it.out.size / it.file.size) * 100);
      sizes.innerHTML = '';
      sizes.append(`${fmtBytes(it.file.size)} to ${fmtBytes(it.out.size)} `);
      const b = document.createElement('b');
      b.className = delta >= 0 ? 'gain' : 'loss';
      b.textContent = delta >= 0 ? `${delta}% smaller` : `${Math.abs(delta)}% larger`;
      sizes.append(b);
    } else if (it.status === 'error') {
      sizes.classList.add('err');
      sizes.textContent = it.error;
    } else {
      const type = (it.file.type || it.file.name.split('.').pop() || 'image').replace('image/', '').toUpperCase();
      sizes.textContent = `${fmtBytes(it.file.size)} · ${type}`;
    }
  }

  function rowOf(it) {
    return els.queue.querySelector(`[data-id="${it.id}"]`);
  }

  /* ---------- Conversion ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This file could not be read as an image.')); };
      img.src = url;
    });
  }

  async function convertItem(it) {
    it.status = 'working';
    paintRow(rowOf(it), it);
    await frame();
    try {
      const fmt = FORMATS[state.format];
      const img = await loadImage(it.file);
      let w = img.naturalWidth || img.width || 1024;
      let h = img.naturalHeight || img.height || 1024;

      const limit = state.maxDim > 0 ? Math.min(state.maxDim, MAX_SIDE) : MAX_SIDE;
      const longest = Math.max(w, h);
      if (longest > limit && (state.maxDim > 0 || longest > MAX_SIDE)) {
        const scale = limit / longest;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (state.format === 'image/jpeg') {
        ctx.fillStyle = state.bg;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      const blob = await new Promise((res) =>
        canvas.toBlob(res, state.format, fmt.lossy ? state.quality : undefined)
      );
      canvas.width = canvas.height = 0;

      if (!blob || blob.type !== state.format) {
        throw new Error(`This browser cannot create ${fmt.label} files. Try another format.`);
      }

      const base = it.file.name.replace(/\.[^.]+$/, '') || 'image';
      it.out = blob;
      it.outName = `${base}.${fmt.ext}`;
      it.error = '';
      it.status = 'done';
    } catch (err) {
      it.out = null;
      it.status = 'error';
      it.error = err.message || 'Conversion failed.';
    }
    paintRow(rowOf(it), it);
  }

  async function convertAll() {
    if (state.busy) return;
    const todo = state.items.filter((i) => i.status !== 'done');
    if (!todo.length) { toast('Everything is already converted.'); return; }

    state.busy = true;
    els.progress.hidden = false;
    els.progressBar.style.width = '0%';
    update();

    let n = 0;
    for (const it of todo) {
      await convertItem(it);
      n++;
      els.progressBar.style.width = `${Math.round((n / todo.length) * 100)}%`;
      update();
    }

    state.busy = false;
    setTimeout(() => { if (!state.busy) els.progress.hidden = true; }, 600);
    update();

    const failed = todo.filter((i) => i.status === 'error').length;
    toast(failed ? `Finished. ${failed} file${failed === 1 ? '' : 's'} could not be converted.` : 'All images converted.');
  }

  function resetResults() {
    if (state.busy) return;
    for (const it of state.items) {
      if (it.status === 'done' || it.status === 'error') {
        it.status = 'ready';
        it.out = null;
        it.error = '';
        paintRow(rowOf(it), it);
      }
    }
    update();
  }

  /* ---------- Downloads ---------- */
  async function downloadZip() {
    const done = state.items.filter((i) => i.status === 'done');
    if (!done.length) { toast('Convert your images first.'); return; }

    if (done.length === 1 && !(state.keepFolders && done[0].dir)) {
      download(done[0].out, done[0].outName);
      return;
    }

    const zip = new JSZip();
    const used = new Set();
    for (const it of done) {
      let path = (state.keepFolders ? it.dir : '') + it.outName;
      let k = 2;
      while (used.has(path.toLowerCase())) {
        path = (state.keepFolders ? it.dir : '') + it.outName.replace(/(\.[^.]+)$/, ` (${k++})$1`);
      }
      used.add(path.toLowerCase());
      zip.file(path, it.out);
    }

    els.zipBtn.disabled = true;
    els.progress.hidden = false;
    els.progressBar.style.width = '0%';
    try {
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'STORE' },
        (m) => { els.progressBar.style.width = `${Math.round(m.percent)}%`; }
      );
      download(blob, 'converted-images.zip');
      toast('Your ZIP is ready.');
    } catch (e) {
      toast('The ZIP could not be created. Try converting fewer files at once.');
    }
    els.progress.hidden = true;
    update();
  }

  function removeItem(id) {
    if (state.busy) return;
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    URL.revokeObjectURL(state.items[idx].thumb);
    state.items.splice(idx, 1);
    els.queue.querySelector(`[data-id="${id}"]`)?.remove();
    update();
  }

  function clearAll() {
    if (state.busy) return;
    state.items.forEach((i) => URL.revokeObjectURL(i.thumb));
    state.items = [];
    els.queue.innerHTML = '';
    update();
  }

  /* ---------- UI state ---------- */
  function update() {
    const n = state.items.length;
    els.results.hidden = n === 0;
    if (!n) return;

    const done = state.items.filter((i) => i.status === 'done');
    const totalIn = state.items.reduce((s, i) => s + i.file.size, 0);

    els.statsMain.textContent = `${n} image${n === 1 ? '' : 's'}`;
    if (done.length) {
      const doneIn = done.reduce((s, i) => s + i.file.size, 0);
      const doneOut = done.reduce((s, i) => s + i.out.size, 0);
      const pct = Math.round((1 - doneOut / doneIn) * 100);
      els.statsSub.textContent = '';
      els.statsSub.append(`${done.length} of ${n} converted · ${fmtBytes(doneIn)} to ${fmtBytes(doneOut)} `);
      const b = document.createElement('b');
      b.textContent = pct >= 0 ? `(${pct}% smaller)` : `(${Math.abs(pct)}% larger)`;
      if (pct < 0) b.style.color = 'var(--bad)';
      els.statsSub.append(b);
    } else {
      els.statsSub.textContent = `${fmtBytes(totalIn)} in total`;
    }

    els.convertBtn.disabled = state.busy || done.length === n;
    els.convertBtn.textContent = state.busy ? 'Converting…' : done.length && done.length < n ? 'Convert remaining' : 'Convert all';
    els.zipBtn.disabled = state.busy || !done.length;
    els.zipBtn.textContent = done.length === 1 && !(state.keepFolders && done[0].dir) ? 'Download image' : 'Download ZIP';
    els.clearBtn.disabled = state.busy;
    els.queue.querySelectorAll('.rm').forEach((b) => (b.disabled = state.busy));
  }

  function syncFormatUi() {
    const fmt = FORMATS[state.format];
    els.qualityField.hidden = !fmt.lossy;
    els.bgField.hidden = state.format !== 'image/jpeg';
    els.formatHint.textContent = fmt.hint;
  }

  /* ---------- Events ---------- */
  els.pickFiles.addEventListener('click', () => els.fileInput.click());
  els.pickFolder.addEventListener('click', () => els.folderInput.click());

  els.fileInput.addEventListener('change', () => {
    addFiles([...els.fileInput.files].map((f) => ({ file: f, path: f.name })));
    els.fileInput.value = '';
  });
  els.folderInput.addEventListener('change', () => {
    addFiles([...els.folderInput.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    els.folderInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('is-over'); })
  );
  ['dragleave', 'dragend'].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => {
      if (e.target === els.drop || !els.drop.contains(e.relatedTarget)) els.drop.classList.remove('is-over');
    })
  );
  els.drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    els.drop.classList.remove('is-over');
    const dt = e.dataTransfer;
    // Entries must be collected synchronously, before any await.
    const entries = dt.items
      ? [...dt.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean)
      : [];
    if (entries.length) {
      toast('Reading files…');
      const lists = await Promise.all(entries.map((en) => readEntry(en)));
      addFiles(lists.flat());
    } else {
      addFiles([...dt.files].map((f) => ({ file: f, path: f.name })));
    }
  });
  // Stop the browser from opening files dropped outside the drop area.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      addFiles(files.map((f, i) => ({ file: f, path: f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png` })));
    }
  });

  els.formatSeg.addEventListener('change', (e) => {
    if (e.target.name !== 'format') return;
    state.format = e.target.value;
    syncFormatUi();
    resetResults();
  });
  els.quality.addEventListener('input', () => {
    state.quality = els.quality.value / 100;
    els.qualityOut.textContent = `${els.quality.value}%`;
  });
  els.quality.addEventListener('change', resetResults);
  els.maxDim.addEventListener('change', () => { state.maxDim = +els.maxDim.value; resetResults(); });
  els.bg.addEventListener('change', () => { state.bg = els.bg.value; resetResults(); });
  els.keepFolders.addEventListener('change', () => { state.keepFolders = els.keepFolders.checked; update(); });

  els.convertBtn.addEventListener('click', convertAll);
  els.zipBtn.addEventListener('click', downloadZip);
  els.clearBtn.addEventListener('click', clearAll);

  els.queue.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = btn.closest('.item');
    const id = +li.dataset.id;
    if (btn.classList.contains('rm')) removeItem(id);
    if (btn.classList.contains('dl')) {
      const it = state.items.find((i) => i.id === id);
      if (it && it.out) download(it.out, it.outName);
    }
  });

  /* ---------- Init ---------- */
  async function detectAvif() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const b = await new Promise((res) => c.toBlob(res, 'image/avif'));
      return !!b && b.type === 'image/avif';
    } catch { return false; }
  }

  detectAvif().then((ok) => {
    if (ok) return;
    els.avifLabel.classList.add('is-disabled');
    els.avifLabel.title = 'Your browser cannot create AVIF files';
    els.avifLabel.querySelector('input').disabled = true;
  });

  window.SB = { download, toast, fmtBytes };
  syncFormatUi();
})();
