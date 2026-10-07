/* Explorer's Guide to Biology — reader enhancements.
   Everything here is optional: without JavaScript, terms link to their dictionary
   pages, answers open via <details>, and videos link out to Vimeo/YouTube. */
(function(){
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];

  /* ---- Bio-Dictionary popovers ---- */
  const dataEl = $('#term-data');
  const TERMS = dataEl ? JSON.parse(dataEl.textContent) : {};
  const pop = document.createElement('div');
  pop.className = 'pop'; pop.hidden = true; pop.setAttribute('role','tooltip');
  document.body.appendChild(pop);
  let hideTimer = null;
  function show(el){
    const e = TERMS[el.dataset.term]; if(!e) return;
    clearTimeout(hideTimer);
    pop.innerHTML = (e.image ? '<div class="pimg"><img alt=""></div>' : '') +
      '<div class="pbody"><div class="src">Bio-Dictionary</div><div class="pt"></div><div class="pd"></div><a>Open entry →</a></div>';
    if(e.image) $('img', pop).src = e.image;
    $('.pt', pop).textContent = e.term;
    $('.pd', pop).textContent = e.definition;
    $('a', pop).href = el.getAttribute('href');
    pop.hidden = false;
    const r = el.getBoundingClientRect(), w = 300, h = pop.offsetHeight;
    pop.style.left = Math.min(Math.max(12, r.left + r.width/2 - w/2), innerWidth - w - 12) + 'px';
    let top = r.bottom + 8; if(top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.top = top + 'px';
  }
  const hideSoon = () => { hideTimer = setTimeout(() => { pop.hidden = true; }, 180); };
  const canHover = matchMedia('(hover: hover)').matches;
  $$('a.term').forEach(a => {
    if(canHover){
      a.addEventListener('mouseenter', () => show(a));
      a.addEventListener('mouseleave', hideSoon);
      a.addEventListener('focus', () => show(a));
      a.addEventListener('blur', hideSoon);
    } else {
      // touch: first tap previews, second tap (or "Open entry") follows the link
      a.addEventListener('click', ev => { if(pop.hidden || pop.dataset.for !== a.id){ ev.preventDefault(); show(a); pop.dataset.for = a.id; } });
    }
  });
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', hideSoon);
  document.addEventListener('click', ev => { if(!ev.target.closest('.term, .pop')) pop.hidden = true; });
  document.addEventListener('keydown', ev => { if(ev.key === 'Escape'){ pop.hidden = true; document.body.classList.remove('toc-open'); } });
  addEventListener('scroll', () => { pop.hidden = true; }, {passive:true});

  /* ---- Click-to-load video ---- */
  $$('.video-frame .play[data-embed]').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    const f = document.createElement('iframe');
    f.src = a.dataset.embed; f.allow = 'autoplay; fullscreen; picture-in-picture'; f.allowFullscreen = true;
    f.title = a.getAttribute('aria-label') || 'Video';
    a.replaceWith(f);
  }));

  /* ---- Contents: scroll spy, progress bar, mobile drawer ---- */
  const links = $$('.toc li a');
  const heads = links.map(l => document.getElementById(l.hash.slice(1))).filter(Boolean);
  const bar = $('.progress span');
  function onScroll(){
    const h = document.documentElement, max = h.scrollHeight - h.clientHeight;
    if(bar) bar.style.width = (max > 0 ? h.scrollTop / max * 100 : 0) + '%';
    let cur = null; heads.forEach(el => { if(el.getBoundingClientRect().top < 120) cur = el.id; });
    links.forEach(l => l.classList.toggle('active', l.hash === '#' + cur));
  }
  addEventListener('scroll', onScroll, {passive:true}); onScroll();
  const menu = $('.menu-btn');
  if(menu) menu.addEventListener('click', () => document.body.classList.toggle('toc-open'));
  links.forEach(l => l.addEventListener('click', () => document.body.classList.remove('toc-open')));

  /* ---- Dictionary index filter ---- */
  const q = $('#dict-filter');
  if(q) q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    $$('.dcard').forEach(c => { c.hidden = v && !c.dataset.search.includes(v); });
    $$('.letter-group').forEach(g => { g.hidden = !$$('.dcard', g).some(c => !c.hidden); });
  });
})();
