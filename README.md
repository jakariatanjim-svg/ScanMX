# ScanMX

**ScanMX is a private, offline document scanner that turns everyday photos into clean, shareable scans.** Use it as a free browser-based alternative to mobile scanning apps, without an account, hosted service, or app-imposed page quota.

## What it does

- Automatically finds document edges, crops the page, straightens perspective, and lets you adjust the four corners by hand.
- Cleans up paper tone and shadows, sharpens details, and offers Smart clean, Color, Grayscale, and Black & white looks.
- Supports multiple pages, rotation, camera capture on supported phones, drag-and-drop, and pasting a screenshot with **Ctrl+V** (or **⌘+V** on Mac).
- Exports a multi-page PDF or an individual page as a PNG image.
- Includes English and বাংলা interface options and adapts to phone, tablet, and desktop screens.

## Privacy

Photos are processed locally in the browser. ScanMX does not upload images, use OCR, require an account, or contact a scanning server. A downloaded standalone release can be opened from a file and used without a network connection. Available image size and speed depend on the device and browser.

## How to use

1. Open ScanMX in a modern browser. For offline use, open the standalone HTML downloaded from the latest ScanMX GitHub release.
2. Add pages by choosing images, taking a photo, dragging files onto the page, or pasting an image from the clipboard.
3. Choose an enhancement style. ScanMX detects the page boundary and shows a cleaned-up preview. Select **Adjust corners** to refine the crop, or rotate the page as needed.
4. Add more pages if needed, then choose **Export PDF** for the complete scan or save the current page as a PNG.

## Development and checks

Use Node.js 22.12+ (Node 22 LTS recommended).

```sh
npm ci
npm run dev
```

Create the self-contained release with `npm run build`; the output is `dist/index.html`.

```sh
npm test                              # PDF structure unit tests
npx playwright install --with-deps chromium
npm run test:e2e                       # Build, then test the actual standalone HTML
```

The browser tests open `dist/index.html` directly over `file://` with networking disabled. They check rendering and engine startup, every enhancement mode, crop handles, rotation, non-blank PNG downloads, and multi-page PDF exports. Pull requests and standalone releases run these checks automatically.

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of installing Playwright's browser. To run the same browser checks against an already-running dev server, use `SCANMX_TEST_URL=http://localhost:5173 npx playwright test` (network access is only disabled for the standalone-file tests).

## Standalone release

The latest release includes a self-contained `ScanMX-YYYY-MM-DD-HH-MM-SS.html` file. Download it from the repository's **Releases** section, then open it in a modern browser. It is ready to use without a separate install or hosting provider.
