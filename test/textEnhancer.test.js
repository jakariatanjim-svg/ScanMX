import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enhanceGray, enhanceRgba } from '../src/textEnhancer.js';

test('the JavaScript forward pass matches the numpy reference from the trainer', async () => {
  const golden = JSON.parse(await readFile(new URL('./fixtures/text-enhancer-golden.json', import.meta.url), 'utf8'));
  const output = enhanceGray(Float32Array.from(golden.input), golden.width, golden.height);
  golden.output.forEach((expected, index) => {
    assert.ok(Math.abs(output[index] - expected) < 2e-4, `pixel ${index}: ${output[index]} vs ${expected}`);
  });
});

test('flat paper and flat grey stay where they are, so no ink is invented', () => {
  const paper = new Float32Array(40 * 30).fill(0.95);
  const out = enhanceGray(paper, 40, 30);
  out.forEach((value) => assert.ok(Math.abs(value - 0.95) < 0.03, `paper drifted to ${value}`));
  const grey = new Float32Array(40 * 30).fill(0.5);
  enhanceGray(grey, 40, 30).forEach((value) => assert.ok(Math.abs(value - 0.5) < 0.05, `grey drifted to ${value}`));
});

test('a blurred dark stroke becomes darker in the centre and the paper stays bright', () => {
  const width = 40;
  const height = 30;
  const profile = [0.95, 0.92, 0.7, 0.45, 0.7, 0.92, 0.95];
  const gray = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - 20 + 3;
      gray[y * width + x] = dx >= 0 && dx < profile.length ? profile[dx] : 0.95;
    }
  }
  const out = enhanceGray(gray, width, height);
  const centre = 15 * width + 20;
  assert.ok(out[centre] < gray[centre] - 0.02, `stroke should deepen: ${out[centre]} vs ${gray[centre]}`);
  assert.ok(out[15 * width + 2] > 0.9, 'paper should stay bright');
});

test('colour is kept: a red block keeps its saturation after enhancement', () => {
  const width = 40;
  const height = 30;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const inside = i % width > 8 && i % width < 32;
    rgba[i * 4] = inside ? 200 : 240;
    rgba[i * 4 + 1] = inside ? 40 : 240;
    rgba[i * 4 + 2] = inside ? 40 : 240;
    rgba[i * 4 + 3] = 255;
  }
  const out = enhanceRgba(rgba, width, height, 1);
  const o = (15 * width + 20) * 4;
  const saturation = (d, p) => (Math.max(d[p], d[p + 1], d[p + 2]) - Math.min(d[p], d[p + 1], d[p + 2])) / Math.max(1, Math.max(d[p], d[p + 1], d[p + 2]));
  assert.ok(saturation(out, o) >= 0.7 * saturation(rgba, o), 'red should not wash out');
  assert.equal(out[o + 3], 255);
});

test('mix 0 returns the input unchanged', () => {
  const width = 20;
  const height = 20;
  const rgba = new Uint8ClampedArray(width * height * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
  const out = enhanceRgba(rgba, width, height, 0);
  assert.deepEqual(Array.from(out), Array.from(rgba));
});
