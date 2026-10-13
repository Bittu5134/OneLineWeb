# OneLineWeb

**Fully functional, self-extracting single-file websites packed into Data URIs under 3 KB.**


## Overview

[Data URIs](https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data) are a web standard that allow inline data (HTML, CSS, JavaScript, media, or shaders) to be embedded directly into a URL string without requiring an external server or hosting provider.

**OneLineWeb** is an experimental collection of interactive, standalone web experiences packed into single-line Data URIs. You can copy any Data URI from this collection, paste it directly into your browser's address bar, and run the entire application instantly offline.

## Showcase

### 1. Glitchy Clock

![Glitchy Clock Preview](./pages/glitchy-clock/media/preview.webp)

An interactive, animated digital clock that procedurally generates audio, renders WebGL animations in the background, and utilizes the Canvas API.

- **Source:** [`pages/glitchy-clock/index.html`](./pages/glitchy-clock/index.html)
- **Source Size:** ~6.7 KB
- **Minified Size:** **~2.6 KB**

#### Runnable Data URI:

```yaml
data:text/html,%3Cscript%3Efetch('data:;base64,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').then(r=%3Enew Response(r.body.pipeThrough(new DecompressionStream('deflate-raw'))).text()).then(t=%3E%7Bdocument.open();document.write(t);document.close()%7D)%3C/script%3E
```

### 2. Draw A Circle

![Draw A Circle Preview](./pages/draw-a-circle/media/showcase.webp)

An interactive drawing game where you trace a circle around the center point and receive a live accuracy score, synthesized audio feedback, and a new-try button.

- **Source:** [`pages/draw-a-circle/index.html`](./pages/draw-a-circle/index.html)
- **Source Size:** ~5.3 KB
- **Minified Size:** **~2.6 KB**

#### Runnable Data URI:

```yaml
data:text/html,%3Cscript%3Efetch('data:;base64,rVZ/b9s2EP0qnrKkVELTtBoHmRR6SIui67AfRRdsK4oApSXKIiKRKkXFFhx/9x1pKXGyZtsfS4D4yDuS7927u/iisV0p5gcLfJBuai2VFWYsboWyTay0ElvvwQcZOBtppVYxXzS6bK1IrK7jGT1MSpFbZ2yPN7lWdpzzSpZd/OK1bo0UZvSLWL3A/QJXWumm5qnYLnTW4cJW5abiZilVTJOVzGwRTylcWgi5LOzO1rfC5KVexYXMMqGSBU9vlka3KosPKKXblKtb3mwy2dQl7+JFqdObh7tuV3uX3RYAu02LMU89mZ7jZoiu1w/BYPfIxrN6PaLw64xkoU0GWTI8k23jM7APKM/zLeTSGq6aXJsq9lbJrUBjiMXjWVSvwyTVpTY+OnFJi6NTeKKByHEjjMyTVSGtGPtMAciV4fXWicCzTKplTGaiGk1F9RSLQ/eApZQKsvUskum5B9KaBpD02idDEn1iLia78rjYZXgkM8bnF5Pdan6RyVu3tYAtMO/X6bBetNZq5bay+ZXpRpdLLtXFZLc9v2hSI2s7T7Vq7MiyTKdtBYVHlsK+KYUzX3XvMhTwIMSC+f3XkCqxtiiIMthUz59JwS2fd8PpxBIvOltJlekVkUoJ84fbwZbsauCR6we/lezQatafnkSYsyF+EkEv2FHJKE7Zp2tsmGrLEmeMJnmrfMGNCmSxAORBA+IEgJHQWbgxd3cIosUK9U9etpnUPdu7u35zJRY30u67whAHTdvUQmUiCxhjhjQWBD46MsSIBsij8B6yIakR4Py1SWUJZaANCgH9sP0WxIGN0m20xkCurmQlEk1sVwumsCa5EV9aodKONML+zstWXPoYoFTCTcTJ+9Ql91xiXUNVKSt5+YFX9ZXeDySUTnF5IkJ4CBArkVrE3dFhYUgmGisVd3l0UcDUWFTuTF0jd3grwDb6RvzmCpcFB6c0zykNsCCuG7y+7LRfveY121k/QvWzwHdNAPJDl71xM/An2VgB2qOgbw9QQQVYs/mmZNOdyIKkpeDmg4NIMcV9YdwXEZQpcVJ5xZRlAYhOfFuRvtdY4JrNQVwImDbvuS1AB0EqmHtXGkE6Sgkn/8SD9THEBXpJKSb0HAfWSK6WJVxA6Fm4Df8Jv7sSCAJ+maNvytAI2xqVpKRumwJt1rEdHhtr3MV8PKw/bsM+aYDoPgjbB0RD4u8LTrEaxjbMHa5SQWCGgUeNs/mMHh2hDAqqQBGlJykphVra4vDsOHKMXuK+NQiNwn+h09YBRuFTNrBwLTidzYe7e8/oiRKXKRQ6T7t4RA+/oor/PxLgWy0zaNvpDNBFAI6vrNa2cADPB66WpaTiNYLMoo2JfwYJSdHV2kKu1sCgAxqFsHzn4ZarCDwdeNZAcTfe+vOWGKhoqEsjsjYVyM0LoGhPBKbhRPSMHEkgqP8TM8cAPUNvYMC/8qIHW4NwAqohCvffh9nmvRVfQ9VPx37RfDGuZyf6GIIzdmkM79D0LCQ5zBtE3ciFenjD08IR3bhZ6Yj7zCR0DlMLiRMWHfvL3r+DOz55E/73w6wSE/TgOoZrD6dn12y6HRg0LHMPQVmgV1pDT6qwBzuZnuGWpZ/oNe7gY6iK8fQa12xPq46sxy3o1ZEOPkGzap+kN/2IQPBF4hiR02NzAn+aE9LjGpJRT3QIP8ljUT4/iPLtptoefn624s7pvPoeKu787xV3FsaoQLPoJYlmmExnD81yHmIYvW6U6tYi1xUFOpt95+OiR2GA3jeW/EpjQTs7BL6p/r/JVqBTP61mj6fVDFAk8B1j9z3gLw==').then(r=%3Enew Response(r.body.pipeThrough(new DecompressionStream('deflate-raw'))).text()).then(t=%3E%7Bdocument.open();document.write(t);document.close()%7D)%3C/script%3E
```

## Local Development


### Installation

```bash
git clone https://github.com/Bittu5134/OneLineWeb.git
cd OneLineWeb
npm install
```

### Development Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts local dev server at `http://localhost:3000` with live reload and the showcase gallery. |
| `npm run build` | Builds all pages into `dist/` and generates the `dist/index.html` showcase gallery. |


## Adding a New Page

1. **Scaffold the page:**
   ```bash
   npm run new -- <slug>
   ```
   Creates `pages/<slug>/` with an `index.html` template, metadata, and media folder.

2. **Author your demo in `pages/<slug>/index.html`:**
   Keep everything self-contained in a single file (inline styles & scripts, procedural audio/visuals, no external network requests).

3. **Preview & monitor budget:**
   ```bash
   npm run dev -- <slug>
   ```
   Open `http://localhost:3000/<slug>` to test with live reload and track your size against the 3 KB limit in the terminal.

## License

This project is licensed under the [MIT License](./LICENSE) — created by [Bittu](https://github.com/Bittu5134).
