#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');

const slug = process.argv.slice(2).find((a) => !a.startsWith('-'));

if (!slug) {
  console.error('\x1b[31mUsage:\x1b[0m npm run new -- <slug>');
  console.error('\x1b[2mExample: npm run new -- laser-grid\x1b[0m');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`\x1b[31mInvalid slug "${slug}".\x1b[0m Use lowercase letters, digits and dashes.`);
  process.exit(1);
}

const pageDir = path.join(PAGES_DIR, slug);
const indexPath = path.join(pageDir, 'index.html');

if (fs.existsSync(pageDir)) {
  console.error(`\x1b[31mpages/${slug} already exists.\x1b[0m`);
  process.exit(1);
}

const title = slug
  .split('-')
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

const template = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="description" content="A one-line website.">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #000;
    color: #fff;
    font-family: monospace;
  }
</style>
</head>
<body>
<h1>${title}</h1>
<script>
  console.log('${slug} ready');
</script>
</body>
</html>
`;

const meta = {
  title,
  description: 'A one-line website.'
};

fs.mkdirSync(path.join(pageDir, 'media'), { recursive: true });
fs.writeFileSync(indexPath, template, 'utf-8');
fs.writeFileSync(
  path.join(pageDir, 'page.json'),
  JSON.stringify(meta, null, 2) + '\n',
  'utf-8'
);

console.log(`\x1b[32mCreated\x1b[0m pages/${slug}/`);
console.log('  index.html   source page');
console.log('  page.json    gallery title/description (optional)');
console.log('  media/       drop preview.webp here for the gallery card');
console.log(`\nRun \x1b[36mnpm run dev\x1b[0m and open \x1b[36mhttp://localhost:3000/${slug}\x1b[0m`);