import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as minifyJs } from 'terser';
import CleanCSS from 'clean-css';
import { PurgeCSS } from 'purgecss';
import zlib from 'node:zlib';
import { Packer } from 'roadroller';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = __dirname;
const PAGES_DIR = path.resolve(ROOT_DIR, 'pages');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');

const BUDGET_BYTES = 3 * 1024; // 3 KB = 3072 bytes
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const cleanCss = new CleanCSS({
  level: {
    1: { all: true },
    2: {
      all: true,
      mergeAdjacentRules: true,
      mergeIntoShorthands: true,
      mergeMedia: true,
      mergeNonAdjacentRules: true,
      mergeSemantically: true,
      removeEmpty: true,
      reduceNonAdjacentRules: true,
      removeDuplicateFontRules: true,
      removeDuplicateMediaBlocks: true,
      removeDuplicateRules: true,
      removeUnusedAtRules: true,
      restructureRules: true
    }
  },
  compatibility: '*'
});

// GLSL minification helper for shader string literals inside script tags
function minifyGLSL(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s*([{}();,=+\-*\/><?:])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

async function compressJS(code) {
  const processedCode = code.replace(
    /`([^`]*(?:precision|gl_FragCoord|gl_Position|void main)[^`]*)`/g,
    (_, glsl) => '`' + minifyGLSL(glsl) + '`'
  );

  try {
    const result = await minifyJs(processedCode, {
      ecma: 2020,
      toplevel: true,
      compress: {
        passes: 5,
        unused: true,
        dead_code: true,
        evaluate: true,
        collapse_vars: true,
        reduce_vars: true,
        inline: 3,
        join_vars: true,
        side_effects: true,
        conditionals: true,
        comparisons: true,
        unsafe: true,
        unsafe_arrows: true,
        unsafe_comps: true,
        unsafe_Function: true,
        unsafe_math: true,
        unsafe_methods: true,
        unsafe_proto: true,
        unsafe_regexp: true,
        unsafe_undefined: true,
        drop_console: false,
        drop_debugger: true,
        pure_getters: true,
        booleans_as_integers: true
      },
      mangle: {
        toplevel: true,
        eval: true
      },
      format: {
        comments: false,
        wrap_func_args: false
      }
    });
    return result.code || code;
  } catch (err) {
    console.warn('\x1b[33mWarning in JS minifier, falling back:\x1b[0m', err.message);
    return code;
  }
}

function compressCSS(cssText, type) {
  if (!cssText) return '';
  if (type === 'inline') {
    try {
      const wrapped = `*{${cssText}}`;
      const minified = cleanCss.minify(wrapped).styles;
      const match = minified.match(/^\*\{([\s\S]*)\}$/);
      let res = match ? match[1] : cssText.trim();
      if (res.endsWith(';')) res = res.slice(0, -1);
      return res;
    } catch {
      return cssText.trim();
    }
  }
  try {
    const output = cleanCss.minify(cssText);
    return output.styles || cssText;
  } catch {
    return cssText;
  }
}

async function purgeUnusedCSS(html) {
  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const matches = [...html.matchAll(styleRegex)];
  if (matches.length === 0) return html;

  const contentWithoutStyles = html.replace(styleRegex, '');
  let processedHtml = html;

  for (const match of matches) {
    const originalCss = match[1];
    try {
      const purgeResult = await new PurgeCSS().purge({
        content: [{ raw: contentWithoutStyles, extension: 'html' }],
        css: [{ raw: originalCss }],
        safelist: {
          standard: [/^:/, /^\*/, 'html', 'body']
        },
        variables: true,
        keyframes: true,
        fontFace: true
      });
      if (purgeResult.length > 0 && purgeResult[0].css) {
        processedHtml = processedHtml.replace(match[0], `<style>${purgeResult[0].css}</style>`);
      }
    } catch {
      // Keep original CSS if purge fails
    }
  }
  return processedHtml;
}

function generateShortNames(count) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  const names = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    let n = i;
    do {
      name = chars[n % chars.length] + name;
      n = Math.floor(n / chars.length) - 1;
    } while (n >= 0);
    names.push(name);
  }
  return names;
}

function mangleIdentifiers(html) {
  const idRegex = /\bid\s*=\s*["']?([a-zA-Z0-9_-]+)["']?/gi;
  const rawIds = [...new Set([...html.matchAll(idRegex)].map(m => m[1]))];

  const classRegex = /\bclass\s*=\s*["']?([^"'>]+)["']?/gi;
  const rawClasses = [...new Set([...html.matchAll(classRegex)].flatMap(m => m[1].trim().split(/\s+/)))].filter(Boolean);

  if (rawIds.length === 0 && rawClasses.length === 0) {
    return html;
  }

  const shortNames = generateShortNames(rawIds.length + rawClasses.length);
  let nameIdx = 0;

  const idMap = new Map();
  for (const id of rawIds) idMap.set(id, shortNames[nameIdx++]);

  const classMap = new Map();
  for (const cls of rawClasses) classMap.set(cls, shortNames[nameIdx++]);

  let out = html;

  out = out.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) => {
    let newCss = css;
    for (const [id, short] of idMap) {
      newCss = newCss.replace(new RegExp('#' + id + '(?=[^a-zA-Z0-9_-]|$)', 'g'), '#' + short);
    }
    for (const [cls, short] of classMap) {
      newCss = newCss.replace(new RegExp('\\.' + cls + '(?=[^a-zA-Z0-9_-]|$)', 'g'), '.' + short);
    }
    return full.replace(css, newCss);
  });

  out = out.replace(/\bid\s*=\s*(["']?)([a-zA-Z0-9_-]+)\1/gi, (match, quote, id) => {
    const short = idMap.get(id);
    return short ? `id=${quote}${short}${quote}` : match;
  });

  out = out.replace(/\bclass\s*=\s*(["']?)([^"'>]+)\1/gi, (match, quote, classList) => {
    const updated = classList.split(/\s+/).map(cls => classMap.get(cls) || cls).join(' ');
    return `class=${quote}${updated}${quote}`;
  });

  out = out.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (full, js) => {
    let newJs = js;
    for (const [id, short] of idMap) {
      newJs = newJs.replace(new RegExp("getElementById\\([\"']" + id + "[\"']\\)", 'g'), `getElementById('${short}')`);
      newJs = newJs.replace(new RegExp("querySelector\\([\"']#" + id + "[\"']\\)", 'g'), `querySelector('#${short}')`);
      newJs = newJs.replace(new RegExp('(?<![a-zA-Z0-9_$.])' + id + '(?![a-zA-Z0-9_$])', 'g'), short);
    }
    for (const [cls, short] of classMap) {
      newJs = newJs.replace(new RegExp("getElementsByClassName\\([\"']" + cls + "[\"']\\)", 'g'), `getElementsByClassName('${short}')`);
      newJs = newJs.replace(new RegExp("querySelector(All)?\\([\"']\\." + cls + "[\"']\\)", 'g'), (m, all) => `querySelector${all || ''}('.${short}')`);
    }
    return full.replace(js, newJs);
  });

  return out;
}

async function packHtmlSelfExtracting(html) {
  const deflated = zlib.deflateRawSync(Buffer.from(html, 'utf-8'), { level: 9 });
  const b64 = deflated.toString('base64');
  const deflateLoader = `<script>fetch('data:;base64,${b64}').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('deflate-raw'))).text()).then(t=>{document.open();document.write(t);document.close()})</script>`;

  let roadrollerLoader = null;
  try {
    const packer = new Packer([{
      data: `document.write(${JSON.stringify(html)})`,
      type: 'js',
      action: 'eval'
    }], {});
    await packer.optimize(1);
    const decoder = packer.makeDecoder();
    const js = decoder.firstLine ? (decoder.firstLine + '\n' + decoder.secondLine) : decoder;
    roadrollerLoader = `<script>${js}</script>`;
  } catch {
    // Keep null if packer fails
  }

  let best = html;
  let bestSize = Buffer.byteLength(encodeToDataURI(html), 'utf-8');

  for (const candidate of [deflateLoader, roadrollerLoader].filter(Boolean)) {
    const uriSize = Buffer.byteLength(encodeToDataURI(candidate), 'utf-8');
    if (uriSize < bestSize) {
      best = candidate;
      bestSize = uriSize;
    }
  }

  return best;
}

function encodeToDataURI(html) {
  const encoded = encodeURIComponent(html)
    .replace(/%20/g, ' ')
    .replace(/%2F/g, '/')
    .replace(/%3A/g, ':')
    .replace(/%3D/g, '=')
    .replace(/%3B/g, ';')
    .replace(/%2C/g, ',')
    .replace(/%2B/g, '+')
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2A/g, '*');

  return `data:text/html,${encoded}`;
}

// Discover all valid pages in the pages/ directory
export function listPages() {
  if (!fs.existsSync(PAGES_DIR)) return [];
  const entries = fs.readdirSync(PAGES_DIR, { withFileTypes: true });
  return entries
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(slug => fs.existsSync(path.join(PAGES_DIR, slug, 'index.html')))
    .sort();
}

export function getPageMetadata(slug) {
  const metaFile = path.join(PAGES_DIR, slug, 'page.json');
  const prettyDefault = slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  let meta = {
    title: prettyDefault,
    description: ''
  };

  if (fs.existsSync(metaFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      meta = { ...meta, ...parsed };
    } catch {
      // ignore
    }
  }

  // Find preview image if any (media/preview.* or media/<slug>.*)
  const mediaDir = path.join(PAGES_DIR, slug, 'media');
  let preview = null;
  if (fs.existsSync(mediaDir)) {
    const files = fs.readdirSync(mediaDir);
    const found = files.find(f => /\.(webp|png|jpe?g|gif|svg)$/i.test(f));
    if (found) {
      preview = `media/${found}`;
    }
  }

  return { slug, ...meta, preview };
}

// Copy media assets for a page into dist/<slug>/media/
function copyPageMedia(slug) {
  const srcMedia = path.join(PAGES_DIR, slug, 'media');
  const dstMedia = path.join(DIST_DIR, slug, 'media');
  if (fs.existsSync(srcMedia)) {
    fs.mkdirSync(dstMedia, { recursive: true });
    for (const f of fs.readdirSync(srcMedia)) {
      const srcFile = path.join(srcMedia, f);
      const dstFile = path.join(dstMedia, f);
      if (fs.statSync(srcFile).isFile()) {
        fs.copyFileSync(srcFile, dstFile);
      }
    }
  }
}

// Build a single page by slug
export async function buildPage(slug) {
  const pageDir = path.join(PAGES_DIR, slug);
  const inputFile = path.join(pageDir, 'index.html');
  const distPageDir = path.join(DIST_DIR, slug);

  if (!fs.existsSync(inputFile)) {
    console.error(`\x1b[31mError: ${inputFile} does not exist.\x1b[0m`);
    return null;
  }

  const raw = fs.readFileSync(inputFile, 'utf-8');
  const rawSize = Buffer.byteLength(raw, 'utf-8');

  const mangledHtml = mangleIdentifiers(raw);
  const purgedHtml = await purgeUnusedCSS(mangledHtml);

  const minifiedHtml = await minifyHtml(purgedHtml, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    collapseBooleanAttributes: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    removeOptionalTags: true,
    removeAttributeQuotes: true,
    minifyCSS: (text, type) => compressCSS(text, type),
    minifyJS: async (text) => await compressJS(text)
  });

  const minifiedSize = Buffer.byteLength(minifiedHtml, 'utf-8');
  const packedHtml = await packHtmlSelfExtracting(minifiedHtml);
  const packedSize = Buffer.byteLength(packedHtml, 'utf-8');
  const dataUri = encodeToDataURI(packedHtml);
  const dataUriSize = Buffer.byteLength(dataUri, 'utf-8');

  fs.mkdirSync(distPageDir, { recursive: true });

  const outMin = path.join(distPageDir, 'minified.html');
  const outPacked = path.join(distPageDir, 'packed.html');
  const outUri = path.join(distPageDir, 'data-uri.txt');

  fs.writeFileSync(outMin, minifiedHtml, 'utf-8');
  fs.writeFileSync(outPacked, packedHtml, 'utf-8');
  fs.writeFileSync(outUri, dataUri, 'utf-8');

  copyPageMedia(slug);

  const timestamp = new Date().toLocaleTimeString();
  const ratio = ((dataUriSize / BUDGET_BYTES) * 100).toFixed(1);
  const remaining = BUDGET_BYTES - dataUriSize;

  const barLength = 25;
  const filled = Math.min(barLength, Math.round((dataUriSize / BUDGET_BYTES) * barLength));
  const empty = Math.max(0, barLength - filled);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  const statusColor = dataUriSize <= BUDGET_BYTES ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`\n\x1b[36m[${timestamp}] Built "${slug}":\x1b[0m`);
  console.log(`  Source:        ${rawSize.toLocaleString()} bytes  (pages/${slug}/index.html)`);
  console.log(`  Minified HTML: ${minifiedSize.toLocaleString()} bytes  (dist/${slug}/minified.html)`);
  console.log(`  Packed HTML:   ${packedSize.toLocaleString()} bytes  (dist/${slug}/packed.html)`);
  console.log(`  Data URI:      ${statusColor}${dataUriSize.toLocaleString()} bytes${reset} / ${BUDGET_BYTES} bytes (${ratio}%)  (dist/${slug}/data-uri.txt)`);
  console.log(`  Budget bar:    [${statusColor}${bar}${reset}] ${remaining >= 0 ? `\x1b[32m${remaining} bytes under limit\x1b[0m` : `\x1b[31m${Math.abs(remaining)} bytes OVER limit!\x1b[0m`}`);

  return {
    slug,
    meta: getPageMetadata(slug),
    rawSize,
    minifiedSize,
    packedSize,
    dataUriSize,
    underBudget: dataUriSize <= BUDGET_BYTES,
    dataUri
  };
}

// Generate the showcase gallery at dist/index.html
export function generateGalleryHtml(results) {
  const cards = results
    .map(r => {
      const m = r.meta;
      const ratio = ((r.dataUriSize / BUDGET_BYTES) * 100).toFixed(1);
      const isOver = r.dataUriSize > BUDGET_BYTES;
      const statusClass = isOver ? 'over' : 'under';
      const statusText = isOver
        ? `${r.dataUriSize - BUDGET_BYTES}B over 3KB`
        : `${BUDGET_BYTES - r.dataUriSize}B under 3KB`;

      const previewImg = m.preview
        ? `<div class="thumb"><img src="${r.slug}/${m.preview}" alt="${escapeHtml(m.title)}" loading="lazy"></div>`
        : `<div class="thumb empty"><span>No preview</span></div>`;

      return `
    <article class="card">
      ${previewImg}
      <div class="card-body">
        <header>
          <h2>${escapeHtml(m.title)}</h2>
          <span class="badge ${statusClass}">${r.dataUriSize.toLocaleString()} B (${ratio}%)</span>
        </header>
        ${m.description ? `<p class="desc">${escapeHtml(m.description)}</p>` : ''}
        <div class="bar"><div class="fill ${statusClass}" style="width: ${Math.min(100, ratio)}%"></div></div>
        <p class="budget-meta">${statusText}</p>
        <div class="actions">
          <a class="btn" href="${r.slug}/" target="_blank" rel="noopener">Source</a>
          <a class="btn" href="${r.slug}/minified" target="_blank" rel="noopener">Minified</a>
          <button class="btn btn-primary" onclick="copyDataUri('${r.slug}')">Copy Data URI</button>
        </div>
        <div class="uri-snippet" id="uri-box-${r.slug}" style="display:none">
          <textarea readonly id="uri-text-${r.slug}">${escapeHtml(r.dataUri)}</textarea>
        </div>
      </div>
    </article>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OneLineWeb Collection</title>
<style>
  :root {
    --bg: #0b0f14;
    --card: #151b23;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
    --ok: #3fb950;
    --bad: #f85149;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", monospace;
    padding: 2rem 1.5rem;
    line-height: 1.5;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  header.hero {
    margin-bottom: 2.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  header.hero h1 { font-size: 2rem; margin-bottom: 0.5rem; font-weight: 700; letter-spacing: -0.02em; }
  header.hero p { color: var(--muted); max-width: 60ch; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform .15s ease, border-color .15s ease;
  }
  .card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .thumb {
    aspect-ratio: 16/9;
    background: #000;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-bottom: 1px solid var(--border);
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb.empty { color: var(--muted); font-size: 0.85rem; font-style: italic; }
  .card-body { padding: 1.25rem; display: flex; flex-direction: column; flex: 1; }
  .card-body header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .card-body h2 { font-size: 1.2rem; font-weight: 600; }
  .desc { color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem; flex: 1; }
  .badge {
    font-size: 0.75rem;
    padding: 2px 8px;
    border-radius: 999px;
    font-family: monospace;
    white-space: nowrap;
  }
  .badge.under { background: rgba(63, 185, 80, 0.15); color: var(--ok); }
  .badge.over  { background: rgba(248, 81, 73, 0.15); color: var(--bad); }
  .bar {
    height: 6px;
    background: rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 0.25rem;
  }
  .bar .fill { height: 100%; border-radius: 3px; }
  .bar .fill.under { background: var(--ok); }
  .bar .fill.over  { background: var(--bad); }
  .budget-meta { font-size: 0.75rem; color: var(--muted); margin-bottom: 1rem; font-family: monospace; }
  .actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .btn {
    display: inline-flex;
    align-items: center;
    font-size: 0.8rem;
    padding: 0.4rem 0.75rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    color: var(--text);
    background: rgba(255,255,255,0.02);
    text-decoration: none;
    cursor: pointer;
    font-family: inherit;
    transition: all .15s ease;
  }
  .btn:hover { background: rgba(255,255,255,0.08); border-color: var(--accent); color: #fff; }
  .btn-primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
  .btn-primary:hover { background: #79b8ff; color: #000; }
  .toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--ok);
    color: #000;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    font-weight: 600;
    font-size: 0.85rem;
    opacity: 0;
    transform: translateY(10px);
    transition: all .2s ease;
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>
<div class="container">
  <header class="hero">
    <h1>OneLineWeb Collection</h1>
    <p>Fully functional self-contained websites packed into tiny Data URIs (budget: 3 KB). Copy the Data URI into your browser address bar to run.</p>
  </header>
  <main class="grid">
    ${cards}
  </main>
</div>
<div id="toast" class="toast">Copied Data URI to clipboard!</div>
<script>
function copyDataUri(slug) {
  const el = document.getElementById('uri-text-' + slug);
  if (!el) return;
  navigator.clipboard.writeText(el.value).then(() => {
    showToast('Copied ' + slug + ' Data URI!');
  }).catch(() => {
    el.select();
    document.execCommand('copy');
    showToast('Copied!');
  });
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}
</script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Build all pages (or a filtered list) and emit dist/index.html gallery
export async function buildAll(filterSlugs = null) {
  const allSlugs = listPages();
  const targets = filterSlugs && filterSlugs.length > 0
    ? allSlugs.filter(s => filterSlugs.includes(s))
    : allSlugs;

  if (targets.length === 0) {
    console.warn('\x1b[33mNo pages found to build.\x1b[0m Put pages in pages/<slug>/index.html');
    return [];
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });

  const results = [];
  for (const slug of targets) {
    const res = await buildPage(slug);
    if (res) results.push(res);
  }

  // Always generate/refresh the gallery with all known pages that exist in dist
  const galleryItems = allSlugs.map(slug => {
    const matched = results.find(r => r.slug === slug);
    if (matched) return matched;

    // Load existing dist data if not rebuilt this turn
    const distPageDir = path.join(DIST_DIR, slug);
    const uriFile = path.join(distPageDir, 'data-uri.txt');
    const dataUri = fs.existsSync(uriFile) ? fs.readFileSync(uriFile, 'utf-8') : '';
    const dataUriSize = Buffer.byteLength(dataUri, 'utf-8');
    return {
      slug,
      meta: getPageMetadata(slug),
      rawSize: 0,
      minifiedSize: 0,
      packedSize: 0,
      dataUriSize,
      underBudget: dataUriSize <= BUDGET_BYTES,
      dataUri
    };
  });

  const galleryHtml = generateGalleryHtml(galleryItems);
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), galleryHtml, 'utf-8');

  console.log(`\n\x1b[32m✔ Built ${results.length} page(s). Gallery updated: dist/index.html\x1b[0m`);
  return results;
}

// Live-reload injection script
const LIVE_RELOAD_SNIPPET = `
<script>
(() => {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onmessage = (e) => {
    if (e.data === 'reload') {
      console.log('[live-reload] Change detected, reloading page...');
      location.reload();
    }
  };
  ws.onclose = () => {
    console.log('[live-reload] Connection closed. Trying to reconnect...');
    setTimeout(() => location.reload(), 1500);
  };
})();
</script>
`;

function injectLiveReload(html) {
  if (html.includes('</body>')) {
    return html.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`);
  }
  return html + LIVE_RELOAD_SNIPPET;
}

export function startDevServer() {
  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
  };

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    let pathname = decodeURIComponent(parsed.pathname);

    // 1. Gallery index
    if (pathname === '/' || pathname === '/index.html') {
      const galleryFile = path.join(DIST_DIR, 'index.html');
      let content = fs.existsSync(galleryFile)
        ? fs.readFileSync(galleryFile, 'utf-8')
        : '<h1>Gallery not built yet. Run build.</h1>';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(injectLiveReload(content));
      return;
    }

    // 2. Parse /<slug>/... routing
    const parts = pathname.slice(1).split('/').filter(Boolean);
    const slug = parts[0];
    const sub = parts[1] || '';

    const pageDir = path.join(PAGES_DIR, slug);
    const distPageDir = path.join(DIST_DIR, slug);

    if (fs.existsSync(pageDir)) {
      // Source preview: /<slug> or /<slug>/
      if (!sub || sub === 'index.html') {
        const srcIndex = path.join(pageDir, 'index.html');
        if (fs.existsSync(srcIndex)) {
          const content = fs.readFileSync(srcIndex, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(injectLiveReload(content));
          return;
        }
      }

      // Minified preview: /<slug>/minified
      if (sub === 'minified' || sub === 'minified.html') {
        const minFile = path.join(distPageDir, 'minified.html');
        if (fs.existsSync(minFile)) {
          const content = fs.readFileSync(minFile, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(injectLiveReload(content));
          return;
        }
      }

      // Packed preview: /<slug>/packed
      if (sub === 'packed' || sub === 'packed.html') {
        const packedFile = path.join(distPageDir, 'packed.html');
        if (fs.existsSync(packedFile)) {
          const content = fs.readFileSync(packedFile, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(injectLiveReload(content));
          return;
        }
      }

      // Raw Data URI string: /<slug>/data-uri
      if (sub === 'data-uri' || sub === 'data-uri.txt') {
        const uriFile = path.join(distPageDir, 'data-uri.txt');
        if (fs.existsSync(uriFile)) {
          const content = fs.readFileSync(uriFile, 'utf-8');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(content);
          return;
        }
      }

      // Media / static files: /<slug>/media/... or any subpath in pages/<slug>
      const candidatePageFile = path.join(pageDir, parts.slice(1).join('/'));
      if (fs.existsSync(candidatePageFile) && fs.statSync(candidatePageFile).isFile()) {
        const ext = path.extname(candidatePageFile).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        fs.createReadStream(candidatePageFile).pipe(res);
        return;
      }
    }

    // 3. Fallback: static files in dist/
    const candidateDist = path.join(DIST_DIR, pathname.slice(1));
    if (fs.existsSync(candidateDist) && fs.statSync(candidateDist).isFile()) {
      const ext = path.extname(candidateDist).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      fs.createReadStream(candidateDist).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({ server });

  function notifyClients() {
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send('reload');
      }
    }
  }

  server.listen(PORT, () => {
    const pages = listPages();
    console.log(`\n\x1b[32m🚀 Live Server running at:\x1b[0m \x1b[36mhttp://localhost:${PORT}/\x1b[0m (Gallery)`);
    if (pages.length > 0) {
      console.log('   Available pages:');
      for (const p of pages) {
        console.log(`     • ${p.padEnd(16)} → \x1b[34mhttp://localhost:${PORT}/${p}\x1b[0m (minified: /${p}/minified)`);
      }
    }
  });

  return { server, notifyClients };
}

// CLI entry point - only run if this file is the entry module
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const args = process.argv.slice(2);
  const isWatch = !args.includes('--no-watch') && !args.includes('build');
  const slugFilters = args.filter(a => !a.startsWith('-') && a !== 'build');

  (async () => {
    const activeSlugs = slugFilters.length > 0 ? slugFilters : null;
    await buildAll(activeSlugs);

    if (isWatch) {
      const { notifyClients } = startDevServer();

      const watchTarget = activeSlugs && activeSlugs.length === 1
        ? path.join(PAGES_DIR, activeSlugs[0])
        : PAGES_DIR;

      console.log(`\n\x1b[35mWatching ${path.relative(ROOT_DIR, watchTarget)} for changes... (Press Ctrl+C to stop)\x1b[0m`);

      let debounceTimer = null;
      chokidar.watch(watchTarget, { ignoreInitial: true, ignored: ['**/node_modules/**', '**/.git/**'] })
        .on('all', (event, filePath) => {
          const rel = path.relative(PAGES_DIR, filePath);
          const changedSlug = rel.split(path.sep)[0];
          if (!changedSlug) return;

          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            try {
              console.log(`\x1b[2mChange in ${rel}...\x1b[0m`);
              await buildAll(changedSlug ? [changedSlug] : null);
              notifyClients();
            } catch (err) {
              console.error('\x1b[31mBuild error:\x1b[0m', err);
            }
          }, 100);
        });
    }
  })();
}
