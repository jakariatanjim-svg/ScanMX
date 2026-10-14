# ScanMX

**ScanMX is a private, offline document scanner that turns everyday photos into clean, shareable scans.** Use it as a free browser-based alternative to mobile scanning apps, without an account, hosted service, or app-imposed page quota.

## What it does

- Automatically finds document edges, crops the page, straightens perspective, and lets you adjust the four corners by hand.
- Smart clean estimates local paper illumination to reduce uneven lighting, color casts and fold shadows while retaining text and colored strokes. Cleanup strength and exposure remain adjustable. Color, Grayscale and Black & white modes are also available.
- Supports multiple pages, rotation, camera capture on supported phones, drag-and-drop, and pasting a screenshot with **Ctrl+V** (or **⌘+V** on Mac).
- Exports a multi-page PDF or an individual page as a PNG image.
- Starts in English, with a বাংলা toggle that remembers your choice. A Bengali font and its SIL Open Font License are embedded in the standalone HTML, so the interface does not depend on an installed Bengali font or a font server. Adapts to phone, tablet and desktop screens.

## Privacy

Photos are processed locally in the browser. ScanMX does not upload images, use OCR, require an account, or contact a scanning server. A downloaded standalone release can be opened from a file and used without a network connection. Available image size and speed depend on the device and browser.

## How to use

1. Open ScanMX in a modern browser. For offline use, open the standalone HTML downloaded from the latest ScanMX GitHub release.
2. Add pages by choosing images, taking a photo, dragging files onto the page, or pasting an image from the clipboard.
3. Smart clean and automatic corner detection run when you open a page. Adjust **Cleanup strength** or choose another enhancement style. Use **Auto-adjust corners** to detect again, **Adjust corners** to refine the crop, or **Use full photo** to remove the crop.
4. Add more pages if needed, then choose **Export PDF** for the complete scan or save the current page as a PNG.

## Smart clean and automatic cropping

Smart clean separates an estimate of the paper background from printed content, corrects each color channel for uneven lighting, and applies gentle contrast and sharpening. The illumination estimate is limited to 900 pixels on its longest edge to keep processing local and practical on mobile devices. The default cleanup strength is 80%; lower it for delicate content, or increase it for stronger shadow reduction. Use Color mode for photographs or large solid graphics.

Automatic cropping combines multiple edge and threshold passes, including a contrast-balanced pass for faint boundaries. It rejects degenerate shapes and camera-frame contours. If it cannot find a convincing page outline, it keeps the full photo rather than forcing a crop. Manual corner adjustments cannot cross or collapse the page boundary.

**Limits:** this is not an AI reconstruction or curved-page dewarping system. It reduces visible fold shadows, but does not unfold curved text, recover obscured writing, remove every sharp crease, or restore detail lost to glare, blur or severe underexposure. For the best result, use a contrasting background, include all four corners, and photograph the page as flat as possible. There is no claim of feature or quality parity with proprietary mobile filters.

## Development and checks

Use Node.js 22.12+ (Node 22 LTS recommended).

```sh
npm ci
npm run dev
```

Create the self-contained release with `npm run build`; the output is `dist/index.html`.

```sh
npm test                              # Scan engine, crop geometry and PDF unit tests
npx playwright install --with-deps chromium
npm run test:e2e                       # Build, then test the actual standalone HTML
```

The browser tests open `dist/index.html` directly over `file://` with networking disabled. They check rendering and engine startup, English/Bengali preferences, every enhancement mode, cleanup strength, automatic and manual cropping, rotation, non-blank PNG downloads, and multi-page PDF exports. Unit fixtures check shadow reduction, ink/color preservation and corner accuracy. Browser checks are run locally; there is no separate test Actions workflow.

For an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its executable instead of installing Playwright's browser. To run the same browser checks against an already-running dev server, use `SCANMX_TEST_URL=http://localhost:5173 npx playwright test` (network access is only disabled for the standalone-file tests).

## Standalone release

The latest release includes a self-contained `ScanMX-YYYY-MM-DD-HH-MM-SS.html` file. Download it from the repository's **Releases** section, then open it in a modern browser. It is ready to use without a separate install or hosting provider.


## Build workflow: release or test artifact

In **Actions → Build standalone HTML → Run workflow**, select the branch to build:

- **`main`**: run unit checks, build the standalone HTML, upload the build artifact, and publish a dated GitHub release.
- **Any other branch**: run the same checks and build, then upload an artifact only. No tag or release is created, regardless of the branch name.

Open the completed run, download `ScanMX-<run ID>-<attempt>` from **Artifacts**, extract the ZIP, and open the HTML file locally to test it. Artifacts are retained for 14 days. Only the main-only release job receives repository write permission. The workflow is manual and does not publish on pushes or pull requests.
