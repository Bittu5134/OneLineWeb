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

const INPUT_FILE = path.resolve(__dirname, 'index.html');
const DIST_DIR = path.resolve(__dirname, 'dist');
const OUTPUT_MIN_HTML = path.join(DIST_DIR, 'minified.html');
const OUTPUT_PACKED_HTML = path.join(DIST_DIR, 'packed.html');
const OUTPUT_DATA_URI = path.join(DIST_DIR, 'data-uri.txt');

const BUDGET_BYTES = 3 * 1024; // 3 KB = 3072 bytes
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const cleanCss = new CleanCSS({
  level: {
    1: {
      all: true
    },
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
    .replace(/\/\*[\s\S]*?\*\//g, '')     // multi-line comments
    .replace(/\/\/.*$/gm, '')              // single-line comments
    .replace(/\s*([{}();,=+\-*\/><?:])\s*/g, '$1') // spaces around operators
    .replace(/\s+/g, ' ')                 // collapse spaces
    .trim();
}

async function compressJS(code) {
  const processedCode = code.replace(/`([^`]*(?:precision|gl_FragCoord|gl_Position|void main)[^`]*)`/g, (_, glsl) => {
    return '`' + minifyGLSL(glsl) + '`';
  });

  try {
    const result = await minifyJs(processedCode, {
      ecma: 2020,
      toplevel: true,
      compress: {
        passes: 5,
        unused: true,          // Drop unreferenced functions, variables, and constants
        dead_code: true,       // Remove unreachable code blocks
        evaluate: true,        // Pre-compute constant expressions (e.g. 1e3, 6 * 10)
        collapse_vars: true,   // Collapse single-use variables into target sites
        reduce_vars: true,     // Track variable assignments to evaluate/inline constants
        inline: 3,             // Inline simple functions and constants
        join_vars: true,       // Combine consecutive var/let/const declarations
        side_effects: true,    // Drop statements without side effects
        conditionals: true,    // Optimize if-return and ternary patterns
        comparisons: true,     // Optimize binary comparisons
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

// Synchronously mangle IDs and Classes across HTML attributes, CSS selectors, and JS references
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

  // 1. Rewrite <style> selectors (#id, .class)
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

  // 2. Rewrite HTML attributes (id="..." and class="...")
  out = out.replace(/\bid\s*=\s*(["']?)([a-zA-Z0-9_-]+)\1/gi, (match, quote, id) => {
    const short = idMap.get(id);
    return short ? `id=${quote}${short}${quote}` : match;
  });

  out = out.replace(/\bclass\s*=\s*(["']?)([^"'>]+)\1/gi, (match, quote, classList) => {
    const updated = classList.split(/\s+/).map(cls => classMap.get(cls) || cls).join(' ');
    return `class=${quote}${updated}${quote}`;
  });

  // 3. Rewrite <script> references (getElementById, querySelector, and global window id references)
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

// Pack HTML into a self-extracting single-file HTML document
async function packHtmlSelfExtracting(html) {
  // Strategy A: Native Browser DecompressionStream (ultra-small decompressor)
  const deflated = zlib.deflateRawSync(Buffer.from(html, 'utf-8'), { level: 9 });
  const b64 = deflated.toString('base64');
  const deflateLoader = `<script>fetch('data:;base64,${b64}').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('deflate-raw'))).text()).then(t=>{document.open();document.write(t);document.close()})</script>`;

  // Strategy B: Roadroller Context-Model LZ decompressor
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

  // Choose whichever candidate produces the smaller Data URI representation
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

// Convert HTML into a standard URL-encoded Data URI (no base64)
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

async function build() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`\x1b[31mError: ${INPUT_FILE} does not exist.\x1b[0m`);
    return null;
  }

  const raw = fs.readFileSync(INPUT_FILE, 'utf-8');
  const rawSize = Buffer.byteLength(raw, 'utf-8');

  // 1. Mangle IDs and Classes across HTML, CSS, and JS
  const mangledHtml = mangleIdentifiers(raw);

  // 2. Purge unused CSS rules, keyframes, and CSS variables
  const purgedHtml = await purgeUnusedCSS(mangledHtml);

  // 3. Minify HTML, JS, and combine/restructure CSS
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

  // 4. Pack into a self-extracting Data URI HTML document
  const packedHtml = await packHtmlSelfExtracting(minifiedHtml);
  const packedSize = Buffer.byteLength(packedHtml, 'utf-8');

  const dataUri = encodeToDataURI(packedHtml);
  const dataUriSize = Buffer.byteLength(dataUri, 'utf-8');

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_MIN_HTML, minifiedHtml, 'utf-8');
  fs.writeFileSync(OUTPUT_PACKED_HTML, packedHtml, 'utf-8');
  fs.writeFileSync(OUTPUT_DATA_URI, dataUri, 'utf-8');

  const timestamp = new Date().toLocaleTimeString();
  const ratio = ((dataUriSize / BUDGET_BYTES) * 100).toFixed(1);
  const remaining = BUDGET_BYTES - dataUriSize;

  const barLength = 25;
  const filled = Math.min(barLength, Math.round((dataUriSize / BUDGET_BYTES) * barLength));
  const empty = Math.max(0, barLength - filled);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  const statusColor = dataUriSize <= BUDGET_BYTES ? '\x1b[32m' : '\x1b[31m';
  const reset = '\x1b[0m';

  console.log(`\n\x1b[36m[${timestamp}] Build finished:\x1b[0m`);
  console.log(`  Source:        ${rawSize.toLocaleString()} bytes`);
  console.log(`  Minified HTML: ${minifiedSize.toLocaleString()} bytes  (${OUTPUT_MIN_HTML})`);
  console.log(`  Packed HTML:   ${packedSize.toLocaleString()} bytes  (${OUTPUT_PACKED_HTML})`);
  console.log(`  Data URI:      ${statusColor}${dataUriSize.toLocaleString()} bytes${reset} / ${BUDGET_BYTES} bytes (${ratio}%)  (${OUTPUT_DATA_URI})`);
  console.log(`  Budget bar:    [${statusColor}${bar}${reset}] ${remaining >= 0 ? `\x1b[32m${remaining} bytes under limit\x1b[0m` : `\x1b[31m${Math.abs(remaining)} bytes OVER limit!\x1b[0m`}`);

  return { raw, minifiedHtml, packedHtml, dataUri };
}

// Live-reload injection script (only served in dev HTTP server, never in minified/data-uri output)
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

function startDevServer() {
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];

    if (url === '/' || url === '/index.html') {
      // Serve the latest index.html with live-reload injected
      let content = fs.existsSync(INPUT_FILE) ? fs.readFileSync(INPUT_FILE, 'utf-8') : '<h1>index.html not found</h1>';
      if (content.includes('</body>')) {
        content = content.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`);
      } else {
        content += LIVE_RELOAD_SNIPPET;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    if (url === '/minified' || url === '/minified.html') {
      // Endpoint to preview the actual minified HTML in the browser with live-reload
      let content = fs.existsSync(OUTPUT_MIN_HTML) ? fs.readFileSync(OUTPUT_MIN_HTML, 'utf-8') : '<h1>Run build first</h1>';
      content += LIVE_RELOAD_SNIPPET;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }

    if (url === '/data-uri') {
      const dataUri = fs.existsSync(OUTPUT_DATA_URI) ? fs.readFileSync(OUTPUT_DATA_URI, 'utf-8') : '';
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(dataUri);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  const wss = new WebSocketServer({ server });

  function notifyClients() {
    for (const client of wss.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send('reload');
      }
    }
  }

  server.listen(PORT, () => {
    console.log(`\n\x1b[32m🚀 Live Server running at:\x1b[0m \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
    console.log(`   - Source preview:   \x1b[34mhttp://localhost:${PORT}/\x1b[0m`);
    console.log(`   - Minified preview: \x1b[34mhttp://localhost:${PORT}/minified\x1b[0m`);
    console.log(`   - Data URI string:  \x1b[34mhttp://localhost:${PORT}/data-uri\x1b[0m`);
  });

  return { server, notifyClients };
}

// Execution
const isWatch = !process.argv.includes('--no-watch') && !process.argv.includes('build');

(async () => {
  await build();

  if (isWatch) {
    const { notifyClients } = startDevServer();

    console.log(`\n\x1b[35mWatching ${path.basename(INPUT_FILE)} for changes... (Press Ctrl+C to stop)\x1b[0m`);
    let debounceTimer = null;
    chokidar.watch(INPUT_FILE, { ignoreInitial: true }).on('change', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          await build();
          notifyClients();
        } catch (err) {
          console.error('\x1b[31mBuild error:\x1b[0m', err);
        }
      }, 100);
    });
  }
})();
