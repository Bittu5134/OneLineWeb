# shortscript ⚡

> Aggressive HTML + CSS + JS + WebGL single-file minifier & self-extracting Data URI packer.

`shortscript` is a high-density build tool designed for strict byte-budget web demos (e.g., JS1k, JS13k, CSS size battles, single-file bookmarks, or sub-3KB data URIs).

It combines multiple minification engines with cross-language AST & selector mangling to pack an entire self-contained application into a URL-encoded `data:text/html,...` URI.

---

## ✨ Features

- **Cross-File Identifier Mangling**: Synchronously detects and mangles HTML IDs and classes down to single-character tokens across HTML attributes, CSS selectors, and JavaScript DOM queries / global references.
- **Aggressive CSS Purging & Restructuring**: 
  - Purges unused CSS rules, keyframes, and CSS custom properties via `purgecss`.
  - Combines identical rule blocks and merges semantic shorthands using `clean-css` (Level 2 advanced).
  - Minifies inline `style="..."` attributes.
- **JavaScript & Shader Compression**:
  - Compresses JS using `terser` with top-level scope mangling, aggressive dead-code elimination, and constant folding.
  - GLSL shader minification for shader string literals embedded in JavaScript template literals.
- **Self-Extracting Stream Decompression**:
  - Evaluates both browser-native `DecompressionStream` and `roadroller` LZ-based compression.
  - Generates self-extracting single-file HTML loaders that unroll the app into the DOM in real time.
- **Budget Tracking & Visual Progress**: Real-time terminal progress bar comparing current size against your target byte budget (default: 3 KB).
- **Instant Live-Reload Dev Server**: Built-in HTTP and WebSocket server for live browser preview and hot reloading during editing.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)

### Installation

```bash
git clone https://github.com/your-username/shortscript.git
cd shortscript
npm install
```

### Development (Live Reload Server)

Start the development server with live watch mode:

```bash
npm run dev
# or
npm run watch
```

- **Source Preview**: `http://localhost:3000/`
- **Minified Preview**: `http://localhost:3000/minified`
- **Raw Data URI**: `http://localhost:3000/data-uri`

### Production Build

Run the builder once without starting the dev server:

```bash
npm run build
```

This generates:
- `dist/minified.html`: Minified HTML/CSS/JS without compression wrappers.
- `dist/packed.html`: Self-extracting HTML document.
- `dist/data-uri.txt`: Ready-to-use URL-encoded `data:text/html,...` string.

---

## ⚙️ Configuration

In `build.js`, you can adjust:

```javascript
const BUDGET_BYTES = 3 * 1024; // Target size budget in bytes (e.g., 3 KB)
const PORT = process.env.PORT || 3000;
```

---

## 📄 License

[MIT](LICENSE)
