(() => {
  const views = { converter: 'Image Converter', resizer: 'Image Resizer', imagegen: 'AI Image Generator', studio: 'Design Studio', vconvert: 'Video Converter', veditor: 'Video Editor', vdownload: 'Video Downloader' };
  const route = () => {
    const id = views[location.hash.slice(1)] ? location.hash.slice(1) : 'converter';
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'v-' + id));
    document.querySelectorAll('.sub a').forEach((a) => a.classList.toggle('on', a.hash === '#' + id));
    document.querySelectorAll('.menu').forEach((m) => { m.classList.remove('open'); m.classList.toggle('active', !!m.querySelector('a.on')); m.querySelector('.mbtn').setAttribute('aria-expanded', 'false'); });
    document.title = views[id] + ' | Designing by Shaban';
    document.body.dataset.currentView = id;
    window.dispatchEvent(new CustomEvent('view', { detail: id }));
  };
  document.querySelectorAll('.mbtn').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = b.parentElement, o = !m.classList.contains('open');
    document.querySelectorAll('.menu').forEach((x) => x.classList.remove('open'));
    m.classList.toggle('open', o); b.setAttribute('aria-expanded', o);
  }));
  function closeMenus() {
    document.querySelectorAll('.menu').forEach((m) => {
      m.classList.remove('open');
      const b = m.querySelector('.mbtn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
  document.querySelectorAll('.sub a').forEach((a) => a.addEventListener('click', closeMenus));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });
  window.addEventListener('hashchange', route); route();
})();
