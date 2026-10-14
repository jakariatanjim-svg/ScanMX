import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const appUrl = process.env.SCANMX_TEST_URL || pathToFileURL(resolve('dist/index.html')).href;

// Generate a real, high-contrast document photo without committing image fixtures.
async function documentPhoto(page, landscape = false) {
  const base64 = await page.evaluate((wide) => {
    const canvas = document.createElement('canvas');
    canvas.width = wide ? 800 : 600;
    canvas.height = wide ? 600 : 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#555';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#eee';
    ctx.fillRect(50, 50, canvas.width - 100, canvas.height - 100);
    ctx.fillStyle = '#111';
    ctx.font = '28px sans-serif';
    ctx.fillText('ScanMX test document', 75, 110);
    for (let i = 0; i < 10; i++) ctx.fillRect(75, 150 + i * 32, canvas.width - 150, 6);
    return canvas.toDataURL('image/png').split(',')[1];
  }, landscape);
  return { name: landscape ? 'landscape.png' : 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

async function waitForPreview(page, oldUrl = '') {
  const preview = page.locator('.preview-frame > img');
  await expect(preview).toHaveAttribute('src', /^blob:/);
  if (oldUrl) await expect(preview).not.toHaveAttribute('src', oldUrl);
  await expect(page.locator('.page-item-thumbnail img').first()).toBeVisible();
  await expect(page.locator('.process-error')).toHaveCount(0);
  await expect(page.locator('.preview-updating, .first-process-state')).toHaveCount(0);
  return preview.getAttribute('src');
}

async function downloadBytes(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

let runtimeErrors;
let networkRequests;

test.beforeEach(async ({ page, context }) => {
  runtimeErrors = [];
  networkRequests = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  if (appUrl.startsWith('file:')) {
    await context.setOffline(true);
    await context.route(/^https?:/, (route) => {
      networkRequests.push(route.request().url());
      return route.abort();
    });
  }
  await page.goto(appUrl);
  // Default language is Bengali; also exercise switching the interface to English.
  await expect(page.getByRole('button', { name: 'Switch language' })).toBeVisible();
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByText('Offline scanner ready', { exact: true })).toBeVisible();
});

test.afterEach(() => {
  expect(runtimeErrors, 'No uncaught browser runtime errors').toEqual([]);
  expect(networkRequests, 'Standalone scanning must not request network assets').toEqual([]);
});

test('standalone HTML renders and starts the scanner without a network connection', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Choose images', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Make every page');
});

test('all enhancements produce previews and a rotated, non-blank PNG', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles(await documentPhoto(page));
  let oldUrl = await waitForPreview(page);
  for (const preset of ['Color', 'Grayscale', 'Black & white', 'Smart clean']) {
    await page.getByRole('button', { name: new RegExp(`^${preset}`) }).click();
    oldUrl = await waitForPreview(page, oldUrl);
  }
  await page.getByRole('button', { name: 'Rotate 90°' }).click();
  await waitForPreview(page, oldUrl);
  await page.getByRole('button', { name: 'More export options' }).click();
  const png = await downloadBytes(page, () => page.getByRole('menuitem', { name: 'Save this page as PNG' }).click());
  expect(png.name).toMatch(/-page-1\.png$/);
  expect([...png.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const pixels = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] !== 255) throw new Error('Unexpected transparent scan output');
      if (data[i] < 80) dark++;
      if (data[i] > 180) light++;
    }
    return { width: image.width, height: image.height, dark, light };
  }, png.bytes.toString('base64'));
  expect(pixels.width).toBeGreaterThan(pixels.height);
  expect(pixels.dark).toBeGreaterThan(1000);
  expect(pixels.light).toBeGreaterThan(1000);
});

test('exports all imported pages to PDF, including a page not yet previewed', async ({ page }) => {
  const files = [await documentPhoto(page), await documentPhoto(page, true)];
  await page.locator('input[type=file]').first().setInputFiles(files);
  await expect(page.locator('.page-item')).toHaveCount(2);
  await waitForPreview(page);
  const pdf = await downloadBytes(page, () => page.getByRole('button', { name: 'Export PDF', exact: true }).click());
  expect(pdf.name).toMatch(/^ScanMX-.*\.pdf$/);
  const text = pdf.bytes.toString('latin1');
  expect(text).toMatch(/^%PDF-1\.4/);
  expect(text).toContain('/Count 2');
  expect(text).toContain('/Kids [3 0 R 6 0 R]');
  expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
  expect(text).toContain('/MediaBox [0 0 841.89 595.28]');
  expect(text.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
  expect(pdf.bytes.length).toBeGreaterThan(10_000);
  const xrefOffset = Number(text.match(/startxref\n(\d+)/)[1]);
  expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
});

test('crop overlay only drags corners when a handle is grabbed', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles(await documentPhoto(page));
  await waitForPreview(page);
  await page.getByRole('button', { name: 'Adjust corners', exact: true }).click();
  const outline = page.locator('.crop-area');
  const original = await outline.getAttribute('points');
  const bounds = await page.locator('.crop-overlay').boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 20, { steps: 3 });
  await page.mouse.up();
  await expect(outline).toHaveAttribute('points', original);

  const handle = await page.locator('.crop-handle-core').first().boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 25, handle.y + 25, { steps: 3 });
  await page.mouse.up();
  await expect(outline).not.toHaveAttribute('points', original);
  await page.getByRole('button', { name: 'Done adjusting', exact: true }).click();
  await waitForPreview(page);
});
