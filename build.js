#!/usr/bin/env node
/*
  Explorer's Guide to Biology — static book builder (multilingual)
  ----------------------------------------------------------------
  Reads:   book.json                         chapter order, collections, languages, publishing rules
           chapters/<slug>.html              chapter text in the default language (as saved by the editor)
           chapters/<slug>.<lang>.html       translations (same markup, translated text)
           dictionary/entries.json           Bio-Dictionary in the default language
           dictionary/entries.<lang>.json    translated terms and definitions (images are shared)
           i18n/<lang>.json                  interface text + translated book metadata
  Writes:  dist/            default language at the root, other languages in dist/<lang>/
  Report:  build-report.md

  Usage:   node build.js            normal build (rights problems are warnings unless book.json says "block")
           node build.js --strict   go-live build (rights problems stop the build)
           node build.js --no-fetch skip downloading remote images/video thumbnails
*/
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, '.cache');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const NO_FETCH = args.includes('--no-fetch');

const book = readJSON('book.json');
const DEFAULT_LANG = book.defaultLanguage || 'en';
const LANGS = book.languages?.length ? book.languages : [DEFAULT_LANG];
const baseDict = readJSON('dictionary/entries.json');
const rightsMode = STRICT ? 'block' : (book.rules?.rights || 'warn');
const allowedRights = new Set(book.rules?.allowedRights || ['original', 'cleared', 'pd']);
const RIGHTS_LABEL = { unknown: 'Not recorded', pending: 'Permission pending', original: 'XBio original', cleared: 'Permission cleared', pd: 'Public domain / CC' };

/* ---------------- problem log ---------------- */
const problems = [];
const report = (level, where, msg) => problems.push({ level, where, msg });
const error = (w, m) => report('error', w, m);
const warn = (w, m) => report('warning', w, m);

/* ---------------- helpers ---------------- */
function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
const exists = p => fs.existsSync(path.join(ROOT, p));
function write(rel, content) { const f = path.join(DIST, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const isRemote = u => /^https?:\/\//i.test(u || '');
const up = n => '../'.repeat(n);
const firstLetter = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')[0].toUpperCase();

/* ---------------- languages ---------------- */
function makeLang(code) {
  const file = `i18n/${code}.json`;
  const data = exists(file) ? readJSON(file) : {};
  if (!exists(file)) warn(file, `Missing interface translations for "${code}"; using ${DEFAULT_LANG}`);
  const fallbackUI = code === DEFAULT_LANG ? {} : (exists(`i18n/${DEFAULT_LANG}.json`) ? readJSON(`i18n/${DEFAULT_LANG}.json`).ui : {});
  const ui = { ...fallbackUI, ...(data.ui || {}) };
  for (const k of Object.keys(fallbackUI)) if (!(k in (data.ui || {}))) warn(file, `Interface text "${k}" is not translated`);
  const plural = new Intl.PluralRules(code);
  const t = (key, vars = {}) => {
    if (key === 'mention') key = 'mention_' + (plural.select(vars.n) === 'one' ? 'one' : 'other');
    return String(ui[key] ?? key).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
  };
  const meta = data.book || {};
  // Dictionary: shared images, translated words
  let dict = baseDict;
  if (code !== DEFAULT_LANG) {
    const tf = `dictionary/entries.${code}.json`;
    const tr = exists(tf) ? readJSON(tf) : {};
    if (!exists(tf)) warn(tf, `No ${data.label || code} dictionary yet; entries are shown in ${DEFAULT_LANG}`);
    dict = {};
    for (const [slug, e] of Object.entries(baseDict)) {
      const x = tr[slug];
      if (exists(tf) && !(x?.term && x?.definition)) warn(tf, `Entry "${e.term}" is not translated`);
      dict[slug] = { ...e, term: x?.term || e.term, definition: x?.definition || e.definition, _fallback: !(x?.term && x?.definition) };
    }
  }
  return {
    code, label: data.label || code, ui, t, meta, dict,
    base: code === DEFAULT_LANG ? '' : code + '/',
    title: meta.title || book.title,
    tagline: meta.tagline || book.tagline,
    banner: meta.banner || book.site?.banner,
    collection: c => meta.collections?.[c.id] || c.title,
    chapterTitle: ch => meta.chapterTitles?.[ch.title] || ch.title,
    chapterMeta: ch => meta.chapters?.[ch.slug] || {},
    date: d => new Intl.DateTimeFormat(code, { year: 'numeric', month: 'long', day: 'numeric' }).format(d),
    usage: {}
  };
}
const languages = LANGS.map(makeLang);

/* ---------------- media: download remote files into dist/media ---------------- */
fs.mkdirSync(CACHE, { recursive: true });
const mediaMemo = new Map();
let mediaFailures = 0;
async function localize(url) {
  if (!isRemote(url) || NO_FETCH) return url;
  if (mediaMemo.has(url)) return mediaMemo.get(url);
  const u = new URL(url);
  const rel = 'media/' + decodeURIComponent(u.pathname).replace(/^\/+/, '').replace(/[^\w.\/-]+/g, '_');
  const cached = path.join(CACHE, rel);
  const job = (async () => {
    try {
      if (!fs.existsSync(cached)) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
      }
      fs.mkdirSync(path.dirname(path.join(DIST, rel)), { recursive: true });
      fs.copyFileSync(cached, path.join(DIST, rel));
      return rel;
    } catch (e) {
      mediaFailures++;
      return url; // fall back to the original address
    }
  })();
  mediaMemo.set(url, job);
  return job;
}
// media paths are relative to the dist root; make them relative to a given page
const media = (p, root) => (!p || isRemote(p) ? p : root + p);

/* ---------------- video thumbnails via oEmbed (cached) ---------------- */
const oembedFile = path.join(CACHE, 'oembed.json');
const oembed = fs.existsSync(oembedFile) ? JSON.parse(fs.readFileSync(oembedFile, 'utf8')) : {};
async function videoThumb(host, id) {
  const key = host + ':' + id;
  if (!(key in oembed) && !NO_FETCH) {
    const page = host === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
    const api = host === 'youtube' ? 'https://www.youtube.com/oembed?format=json&url=' : 'https://vimeo.com/api/oembed.json?width=1280&url=';
    try {
      const r = await fetch(api + encodeURIComponent(page), { signal: AbortSignal.timeout(10000) });
      if (r.ok) oembed[key] = (await r.json()).thumbnail_url || null;
    } catch (e) { /* offline: leave uncached so the next build tries again */ }
  }
  return oembed[key] ? localize(oembed[key]) : null;
}

/* ---------------- page shell ---------------- */
// rel = path of the page inside its language folder, e.g. "index.html" or "dictionary/axon.html"
function pageCtx(L, rel) {
  const depth = rel.split('/').length - 1;
  return { prefix: up(depth), root: up(depth + (L.base ? 1 : 0)) };
}
function shell(L, rel, { title, body, nav, description = '', bodyClass = '', page = '', extraScript = '' }) {
  const { prefix, root } = pageCtx(L, rel);
  const navLink = (href, label, key) => `<a href="${prefix}${href}"${nav === key ? ' aria-current="page"' : ''}>${esc(label)}</a>`;
  const alt = languages.map(X => `<link rel="alternate" hreflang="${X.code}" href="${root}${X.base}${rel}">`).join('\n');
  const toggle = languages.length > 1 ? `<nav class="lang" aria-label="${esc(L.t('language'))}"><span class="globe" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg></span>${languages.map(X =>
    `<a href="${root}${X.base}${rel}" hreflang="${X.code}" lang="${X.code}" title="${esc(X.label)}"${X.code === L.code ? ' aria-current="true"' : ''}>${X.code.toUpperCase()}</a>`).join('')}</nav>` : '';
  const uiData = { source: L.t('dictionary'), open: L.t('openEntry') };
  return `<!doctype html>
<html lang="${L.code}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">${book.site?.noindex ? '\n<meta name="robots" content="noindex, nofollow">' : ''}
${alt}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Figtree:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${root}assets/reader.css">
</head>
<body class="${bodyClass}"${page ? ` data-page="${page}"` : ''}>
<a class="skip" href="#main">${esc(L.t('skip'))}</a>
${L.banner ? `<div class="proto-banner">${esc(L.banner)}</div>` : ''}
<header class="topbar">
  <div class="topbar-inner">
    <button class="menu-btn" aria-label="${esc(L.t('openContents'))}">☰</button>
    <a class="brand" href="${prefix}index.html"><span class="brand-mark">X</span><span class="brand-name">${esc(L.title)}</span></a>
    <nav class="nav" aria-label="${esc(L.t('mainNav'))}">${navLink('index.html', L.t('library'), 'library')}${navLink('dictionary/index.html', L.t('dictionary'), 'dictionary')}</nav>
    ${toggle}
  </div>
  <div class="progress"><span></span></div>
</header>
${body}
<footer class="site"><div>${esc(L.title)} · ${esc(L.t('built', { date: L.date(new Date()) }))}</div></footer>
<script type="application/json" id="ui-data">${JSON.stringify(uiData).replace(/</g, '\\u003c')}</script>
${extraScript}<script src="${root}assets/reader.js" defer></script>
</body>
</html>`;
}

/* ---------------- chapter processing ---------------- */
async function buildChapter(L, ch, collection) {
  const translated = L.code === DEFAULT_LANG ? ch.file : ch.file.replace(/\.html$/, `.${L.code}.html`);
  const hasTranslation = exists(translated);
  if (!hasTranslation) warn(translated, `No ${L.label} translation; the ${DEFAULT_LANG} text is shown instead`);
  const where = hasTranslation ? translated : ch.file;
  const rel = `${ch.slug}.html`;
  const { root } = pageCtx(L, rel);
  const dict = L.dict;
  const src = fs.readFileSync(path.join(ROOT, where), 'utf8');
  const $ = cheerio.load(src, null, false);

  // 1. Strip editor-only markup
  $('.block-tools, .reveal').remove();
  $('[contenteditable]').removeAttr('contenteditable');
  $('[data-block]').removeAttr('data-block');
  $('[data-edit]').removeAttr('data-edit');
  $('.term-suggest').each((_, el) => { $(el).replaceWith($(el).contents()); });
  $('.summary').each((_, el) => { el.name = 'section'; });

  // 2. Headings -> ids + table of contents
  const toc = [];
  const seenIds = new Set();
  $('h2').each((_, el) => {
    let id = 's-' + slugify($(el).text()); while (seenIds.has(id)) id += '-2';
    seenIds.add(id); $(el).attr('id', id); toc.push({ id, text: $(el).text().trim() });
  });

  // 3. Bio-Dictionary terms -> real links (work without JavaScript)
  const termsHere = {};
  $('.term').each((_, el) => {
    const $el = $(el); const slug = $el.attr('data-term'); const text = $el.text().trim();
    if (!dict[slug]) { error(where, `"${text}" is linked to dictionary entry "${slug}", which does not exist`); $el.replaceWith($el.contents()); return; }
    termsHere[slug] = (termsHere[slug] || 0) + 1;
    const id = `t-${slug}-${termsHere[slug]}`;
    $el.replaceWith(`<a class="term" href="dictionary/${slug}.html" data-term="${slug}" id="${id}">${$el.html()}</a>`);
  });
  const title = L.chapterTitle(ch);
  for (const [slug, count] of Object.entries(termsHere)) (L.usage[slug] ||= []).push({ slug: ch.slug, title, id: `t-${slug}-1`, count });

  // 4. Figures: rights status, alt text, local copies of images
  const figJobs = [];
  $('figure.fig').each((_, el) => {
    const $f = $(el);
    const label = $f.find('figcaption b').first().text().replace(/[.:\s\u00a0]+$/, '') || 'Untitled figure';
    const rights = $f.find('select[data-rights] option[selected]').attr('value') || $f.attr('data-rights') || 'unknown';
    $f.find('.rights').remove();
    $f.attr('data-rights', rights);
    // rights are a property of the image, so report them once (default language only)
    if (L.code === DEFAULT_LANG && !allowedRights.has(rights)) {
      const msg = `${label}: rights status is "${RIGHTS_LABEL[rights] || rights}"`;
      rightsMode === 'block' ? error(where, msg) : warn(where, msg);
    }
    const $img = $f.find('img');
    if (!$img.length) { error(where, `${label}: has no image`); return; }
    if (!($img.attr('alt') || '').trim()) error(where, `${label}: image is missing alt text`);
    $img.attr('loading', 'lazy').attr('decoding', 'async');
    figJobs.push(localize($img.attr('src')).then(p => $img.attr('src', media(p, root))));
  });
  await Promise.all(figJobs);

  // 5. Videos: thumbnail + click-to-load (links out if JavaScript is off)
  const vidJobs = [];
  $('figure.video').each((_, el) => {
    const $v = $(el); const host = $v.attr('data-host') || 'vimeo'; const id = $v.attr('data-vid'); const n = $v.attr('data-n') || '';
    if (!id) { error(where, `Video ${n} has no video ID`); return; }
    const watch = host === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`;
    const embed = host === 'youtube' ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=1` : `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1`;
    vidJobs.push(videoThumb(host, id).then(thumb => {
      const style = thumb ? ` style="background-image:url('${media(thumb, root)}')"` : '';
      const vl = L.t('videoLang');
      $v.find('.video-frame').replaceWith(
        `<div class="video-frame"><a class="play${thumb ? ' has-thumb' : ''}" href="${watch}" data-embed="${embed}" aria-label="${esc(L.t('playVideo', { n }))}"${style}><span class="circle"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span><small>${esc(L.t('video', { n }))}${vl ? ` <span class="vl">· ${esc(vl)}</span>` : ''}</small></a></div>`);
    }));
  });
  await Promise.all(vidJobs);

  // 6. Explorer's Questions -> <details> so answers open without JavaScript
  $('.eq').each((_, el) => {
    const $q = $(el);
    const q = $q.find('.q').html() || ''; const a = $q.find('.a').html() || '';
    if (!a.trim() || /Type the answer/.test(a)) warn(where, `Explorer's Question "${$q.find('.q').text().slice(0, 50)}…" has no answer`);
    $q.replaceWith(`<aside class="eq"><div class="lbl">${esc(L.t('explorersQuestion'))}</div><div class="q">${q}</div><details><summary>${esc(L.t('showAnswer'))}</summary><div class="a">${a}</div></details></aside>`);
  });

  // 7. Leftover placeholder text from the editor
  const text = $.root().text();
  for (const ph of ['Type the question', 'Type a short note', 'Untitled']) if (text.includes(ph)) warn(where, `Contains placeholder text "${ph}…"`);

  // Assemble page
  const termData = {};
  for (const slug of Object.keys(termsHere)) termData[slug] = { term: dict[slug].term, definition: dict[slug].definition, image: media(dict[slug]._image, root) };
  const railItems = Object.keys(termsHere).sort((a, b) => dict[a].term.localeCompare(dict[b].term, L.code)).map(s =>
    `<a class="rail-item" href="#t-${s}-1"><img src="${media(dict[s]._thumb, root)}" alt="" loading="lazy"><span><b>${esc(dict[s].term)}</b><span>${esc(L.t('mention', { n: termsHere[s] }))}</span></span></a>`).join('');
  const sci = ch.scientist;
  const cm = L.chapterMeta(ch);
  const photo = sci?.photo ? await localize(sci.photo) : '';
  const words = text.split(/\s+/).length;
  const published = cm.published || ch.published;
  const body = `<div class="reader">
  <aside class="toc" aria-label="${esc(L.t('chapterContents'))}">
    <a class="back" href="index.html">${esc(L.t('backLibrary'))}</a>
    <h2>${esc(L.t('inThisKD'))}</h2>
    <ol>${toc.map(t => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join('')}</ol>
  </aside>
  <main class="chapter" id="main">
    <div class="crumbs"><a href="index.html">${esc(L.t('keyDiscoveries'))}</a> › ${esc(L.collection(collection))} › ${esc(ch.year)}</div>
    <h1 class="ch-title">${esc(title)}</h1>
    <div class="ch-meta">${esc(sci ? `${sci.name}, ${sci.affiliation}` : ch.authors)}${published ? ' · ' + esc(L.t('published', { date: published })) : ''} · ${esc(L.t('minRead', { n: Math.max(1, Math.round(words / 220)) }))}</div>
    ${sci ? `<div class="spotlight">${photo ? `<img src="${media(photo, root)}" alt="${esc(L.t('portraitOf', { name: sci.name }))}">` : ''}<div><div class="lbl">${esc(L.t('spotlight'))}</div><p>${esc(cm.bio || sci.bio)}</p></div></div>` : ''}
    ${hasTranslation ? '' : `<p class="notice">${esc(L.t('notTranslated'))}</p>`}
    <div class="prose"${hasTranslation ? '' : ` lang="${DEFAULT_LANG}"`}>${$.html()}</div>
  </main>
  <aside class="rail" aria-label="${esc(L.t('railLabel'))}">
    <h2>${esc(L.t('railTitle', { n: Object.keys(termsHere).length }))}</h2>
    <div class="rail-list">${railItems}</div>
  </aside>
</div>`;
  write(L.base + rel, shell(L, rel, {
    title: `${title} | ${L.title}`, body, nav: 'library', bodyClass: 'has-toc',
    description: $('section.summary').clone().children('.lbl').remove().end().text().trim().slice(0, 160),
    extraScript: `<script type="application/json" id="term-data">${JSON.stringify(termData).replace(/</g, '\\u003c')}</script>\n`
  }));
  return { lang: L.code, slug: ch.slug, title, translated: hasTranslation, figures: $('figure.fig').length, videos: $('figure.video').length, terms: Object.keys(termsHere).length, words };
}

/* ---------------- library page ---------------- */
async function buildLibrary(L) {
  const rel = 'index.html';
  const { root } = pageCtx(L, rel);
  const sections = [];
  for (const c of book.collections) {
    const cards = [];
    for (const ch of c.chapters) {
      const cover = ch.cover ? await localize(ch.cover) : '';
      const inner = `<div class="thumb">${cover ? `<img src="${media(cover, root)}" alt="" loading="lazy">` : ''}</div><div class="body"><span class="yr">${esc(ch.year)}</span><span class="t">${esc(L.chapterTitle(ch))}</span><span class="a">${esc(ch.authors)}</span></div>`;
      cards.push(ch.slug ? `<a class="card" href="${ch.slug}.html">${inner}</a>` : `<div class="card pending"><span class="badge">${esc(L.t('notMigrated'))}</span>${inner}</div>`);
    }
    sections.push(`<section class="coll" id="${c.id}"><h2>${esc(L.collection(c))}</h2><div class="cards">${cards.join('')}</div></section>`);
  }
  const hero = esc(L.t('heroText', { link: '\u0000' })).replace('\u0000', `<a href="dictionary/index.html">${esc(L.t('dictionary'))}</a>`);
  write(L.base + rel, shell(L, rel, {
    title: L.title, nav: 'library', page: 'library', description: L.tagline,
    body: `<main class="wrap" id="main"><section class="hero"><div class="eyebrow">${esc(L.t('eyebrow'))}</div><h1>${esc(L.tagline)}</h1><p>${hero}</p></section>${sections.join('')}</main>`
  }));
}

/* ---------------- dictionary pages ---------------- */
function buildDictionary(L) {
  const dict = L.dict;
  const slugs = Object.keys(dict).sort((a, b) => dict[a].term.localeCompare(dict[b].term, L.code));
  const groups = {};
  for (const s of slugs) (groups[firstLetter(dict[s].term)] ||= []).push(s);
  const az = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(X => groups[X] ? `<a href="#letter-${X}">${X}</a>` : `<span>${X}</span>`).join('');
  const grid = Object.keys(groups).sort().map(X => `<div class="letter-group"><h2 class="letter" id="letter-${X}">${X}</h2><div class="dgrid">${groups[X].map(s => {
    const e = dict[s];
    return `<a class="dcard" href="${s}.html" data-search="${esc((e.term + ' ' + e.definition).toLowerCase())}"${e._fallback ? ` lang="${DEFAULT_LANG}"` : ''}><div class="dimg">${e._thumb ? `<img src="${media(e._thumb, pageCtx(L, 'dictionary/index.html').root)}" alt="" loading="lazy">` : ''}</div><div class="db"><b>${esc(e.term)}</b><span>${esc(e.definition)}</span></div></a>`;
  }).join('')}</div></div>`).join('');
  write(L.base + 'dictionary/index.html', shell(L, 'dictionary/index.html', {
    title: `${L.t('dictionary')} | ${L.title}`, nav: 'dictionary', description: L.t('dictDescription'),
    body: `<main class="wrap" id="main"><div class="dict-head"><div><div class="eyebrow">${esc(L.t('visualGlossary'))}</div><h1>${esc(L.t('dictionary'))}</h1><p>${esc(L.t('dictIntro'))}</p></div><input id="dict-filter" type="search" placeholder="${esc(L.t('filter'))}" aria-label="${esc(L.t('filter'))}"></div><nav class="az" aria-label="${esc(L.t('jumpLetter'))}">${az}</nav>${grid}</main>`
  }));

  slugs.forEach((s, i) => {
    const e = dict[s];
    const rel = `dictionary/${s}.html`;
    const { root } = pageCtx(L, rel);
    if (L.code === DEFAULT_LANG) {
      if (!e.definition?.trim()) error('dictionary/entries.json', `Entry "${e.term}" has no definition`);
      if (!e._image) warn('dictionary/entries.json', `Entry "${e.term}" has no illustration`);
    }
    const used = L.usage[s] || [];
    const prev = slugs[i - 1], next = slugs[i + 1];
    write(L.base + rel, shell(L, rel, {
      title: `${e.term} | ${L.t('dictionary')}`, nav: 'dictionary', description: e.definition,
      body: `<main class="entry" id="main"${e._fallback ? ` lang="${DEFAULT_LANG}"` : ''}><div class="crumbs"><a href="index.html">${esc(L.t('dictionary'))}</a> › ${esc(firstLetter(e.term))}</div><h1>${esc(e.term)}</h1>${e._image ? `<div class="detail-img"><img src="${media(e._image, root)}" alt="${esc(L.t('illustrationOf', { term: e.term }))}"></div>` : ''}<p class="def">${esc(e.definition)}</p><h2>${esc(L.t('appearsIn'))}</h2>${used.length ? `<ul>${used.map(u => `<li><a href="../${u.slug}.html#${u.id}">${esc(u.title)}</a> (${esc(L.t('mention', { n: u.count }))})</li>`).join('')}</ul>` : `<p>${esc(L.t('notLinked'))}</p>`}<nav class="pager">${prev ? `<a href="${prev}.html">← ${esc(dict[prev].term)}</a>` : '<span></span>'}${next ? `<a href="${next}.html">${esc(dict[next].term)} →</a>` : ''}</nav></main>`
    }));
  });
}

/* ---------------- link checker (runs on the finished site) ---------------- */
function checkLinks() {
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); } })(DIST);
  const idCache = new Map();
  const idsOf = f => { if (!idCache.has(f)) { const $ = cheerio.load(fs.readFileSync(f, 'utf8')); idCache.set(f, new Set($('[id]').map((_, e) => $(e).attr('id')).get())); } return idCache.get(f); };
  let checked = 0;
  for (const f of files) {
    const $ = cheerio.load(fs.readFileSync(f, 'utf8'));
    const rel = path.relative(DIST, f);
    $('a[href], img[src], link[href], script[src]').each((_, el) => {
      const ref = $(el).attr('href') || $(el).attr('src');
      if (!ref || isRemote(ref) || /^(mailto:|tel:|data:)/.test(ref)) return;
      checked++;
      const [p, hash] = ref.split('#');
      const target = p ? path.resolve(path.dirname(f), p) : f;
      if (!fs.existsSync(target)) return error(rel, `Broken link: ${ref}`);
      if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) error(rel, `Link points to a missing section: ${ref}`);
    });
  }
  return { pages: files.length, links: checked };
}

/* ---------------- main ---------------- */
(async function main() {
  const t0 = Date.now();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  for (const f of ['reader.css', 'reader.js']) write('assets/' + f, fs.readFileSync(path.join(ROOT, 'src', f)));
  write('.nojekyll', '');
  if (book.site?.noindex) write('robots.txt', 'User-agent: *\nDisallow: /\n');

  // Dictionary images are shared by every language
  await Promise.all(Object.values(baseDict).map(async e => {
    e._image = e.image ? await localize(e.image) : '';
    e._thumb = e.thumb ? await localize(e.thumb) : e._image;
  }));
  for (const L of languages) if (L.code !== DEFAULT_LANG) for (const [s, e] of Object.entries(L.dict)) { e._image = baseDict[s]._image; e._thumb = baseDict[s]._thumb; }

  const built = [];
  for (const L of languages) {
    for (const c of book.collections) for (const ch of c.chapters) {
      if (!ch.file) continue;
      if (!exists(ch.file)) { if (L.code === DEFAULT_LANG) error('book.json', `Chapter file not found: ${ch.file}`); continue; }
      built.push(await buildChapter(L, ch, c));
    }
    await buildLibrary(L);
    buildDictionary(L);
    write(L.base + '404.html', shell(L, '404.html', { title: L.t('notFound'), nav: '', body: `<main class="wrap" id="main"><h1>${esc(L.t('notFound'))}</h1><p><a href="index.html">${esc(L.t('backToLibrary'))}</a></p></main>` }));
  }
  fs.writeFileSync(oembedFile, JSON.stringify(oembed, null, 2));
  if (mediaFailures) warn('media', `${mediaFailures} image(s) could not be downloaded, so the site still points to their original web addresses`);
  const links = checkLinks();

  /* ---- report ---- */
  const errors = problems.filter(p => p.level === 'error'), warnings = problems.filter(p => p.level === 'warning');
  const ok = errors.length === 0;
  const lines = [
    `# Build report`, ``,
    `**Result:** ${ok ? 'PASSED, ready to deploy' : 'FAILED, not deployed'}  `,
    `**Mode:** ${STRICT ? 'go-live (strict)' : 'standard'} · rights problems ${rightsMode === 'block' ? 'block the build' : 'are warnings'}  `,
    `**Languages:** ${languages.map(L => `${L.label} (${L.code}${L.code === DEFAULT_LANG ? ', default' : ''})`).join(', ')}  `,
    `**Built:** ${new Date().toISOString()} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, ``,
    `| Language | Chapter | Translated | Words | Figures | Videos | Dictionary terms |`, `|---|---|---|---:|---:|---:|---:|`,
    ...built.map(b => `| ${b.lang} | ${b.title} | ${b.translated ? 'yes' : '**no, shows ' + DEFAULT_LANG + '**'} | ${b.words} | ${b.figures} | ${b.videos} | ${b.terms} |`), ``,
    `Dictionary: ${Object.keys(baseDict).length} entries · Pages: ${links.pages} · Internal links checked: ${links.links}`, ``,
    `## Errors (${errors.length})`, ...(errors.length ? errors.map(p => `- **${p.where}**: ${p.msg}`) : ['None.']), ``,
    `## Warnings (${warnings.length})`, ...(warnings.length ? warnings.map(p => `- **${p.where}**: ${p.msg}`) : ['None.']), ``
  ];
  fs.writeFileSync(path.join(ROOT, 'build-report.md'), lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));

  console.log(`\n${ok ? '✔ Build passed' : '✘ Build failed'}  (${languages.length} languages, ${built.length} chapter pages, ${links.pages} pages, ${links.links} links checked)`);
  for (const p of errors) console.log(`  ERROR    ${p.where}: ${p.msg}`);
  for (const p of warnings) console.log(`  warning  ${p.where}: ${p.msg}`);
  console.log(`\nFull report: build-report.md${ok ? '\nSite: dist/index.html' : ''}\n`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
