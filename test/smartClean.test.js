import test from 'node:test';
import assert from 'node:assert/strict';
import cvModule from '@techstark/opencv-js';
import { smartClean } from '../src/smartClean.js';

const cv = await cvModule;

function makePage() {
  const width = 600;
  const height = 800;
  const page = new cv.Mat(height, width, cv.CV_8UC4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Broad side shadow and a smooth, darker fold down the center.
      const lighting = (0.55 + 0.45 * x / width) * (1 - 0.42 * Math.exp(-(((x - 300) / 32) ** 2)));
      const ink = y >= 100 && y < 700 && y % 32 < 4 && x > 50 && x < 550;
      const tone = ink ? 28 : 238;
      const i = (y * width + x) * 4;
      page.data.set([tone * lighting, tone * lighting * 0.97, tone * lighting * 0.92, 255], i);
    }
  }
  return page;
}

function range(values) { return Math.max(...values) - Math.min(...values); }
function samples(page, y) {
  return [30, 150, 270, 300, 330, 450, 570].map((x) => page.data[(y * page.cols + x) * 4]);
}

test('Smart clean reduces broad and fold shadows while preserving text contrast', () => {
  const input = makePage();
  const output = smartClean(cv, input);
  try {
    const before = samples(input, 80);
    const after = samples(output, 80);
    assert.ok(range(after) < range(before) * 0.35, `Paper variation should decrease: ${before} -> ${after}`);
    assert.ok(Math.min(...after) > 200, `Shadowed paper should brighten: ${after}`);
    for (const x of [100, 300, 500]) {
      const ink = output.data[(128 * output.cols + x) * 4];
      const paper = output.data[(120 * output.cols + x) * 4];
      assert.ok(paper - ink > 150, `Ink contrast at x=${x}: ${paper - ink}`);
    }
    assert.equal(output.rows, input.rows);
    assert.equal(output.cols, input.cols);
    assert.equal(output.channels(), 4);
  } finally {
    input.delete(); output.delete();
  }
});

test('cleanup strength is adjustable, preserves colored strokes, and leaves input unchanged', () => {
  const input = makePage();
  cv.line(input, new cv.Point(80, 740), new cv.Point(500, 740), new cv.Scalar(160, 20, 35, 255), 3);
  const original = input.data.slice();
  const off = smartClean(cv, input, { cleanup: 0 });
  const strong = smartClean(cv, input, { cleanup: 100 });
  try {
    assert.deepEqual(off.data, original);
    assert.deepEqual(input.data, original);
    assert.ok(range(samples(strong, 80)) < range(samples(off, 80)) * 0.25);
    const index = (740 * input.cols + 200) * 4;
    assert.ok(strong.data[index] > strong.data[index + 1] + 80, 'Red ink should remain red');
    assert.equal(strong.data[index + 3], 255);
  } finally {
    input.delete(); off.delete(); strong.delete();
  }
});

test('dark and tiny inputs return finite opaque pixels without crashing', () => {
  const input = new cv.Mat(2, 2, cv.CV_8UC4, new cv.Scalar(0, 0, 0, 255));
  const output = smartClean(cv, input);
  try {
    assert.deepEqual([...output.data], [...input.data]);
  } finally { input.delete(); output.delete(); }
});

test('a blank page is stretched to white without dividing by zero', () => {
  const input = new cv.Mat(300, 400, cv.CV_8UC4, new cv.Scalar(232, 232, 232, 255));
  for (let i = 0; i < input.data.length; i += 4) input.data[i] = Math.max(0, Math.min(255, input.data[i] + ((i / 4) % 7) - 3));
  const output = smartClean(cv, input);
  try {
    for (let i = 0; i < output.data.length; i += 4) {
      assert.ok(output.data[i] >= 245 && output.data[i + 1] >= 245 && output.data[i + 2] >= 245, `pixel ${i / 4} is not white`);
    }
  } finally { input.delete(); output.delete(); }
});

test('warm paper tint is neutralised to white while colored ink keeps its hue', () => {
  const input = new cv.Mat(400, 400, cv.CV_8UC4, new cv.Scalar(200, 225, 240, 255));
  cv.line(input, new cv.Point(60, 200), new cv.Point(340, 200), new cv.Scalar(30, 40, 150, 255), 5);
  const output = smartClean(cv, input);
  try {
    const paper = (400 * 20 + 40) * 4;
    const [r, g, b] = [output.data[paper], output.data[paper + 1], output.data[paper + 2]];
    assert.ok(Math.abs(r - b) <= 6 && r >= 245 && g >= 245, `Paper should be neutral white: ${r},${g},${b}`);
    const ink = (200 * 400 + 200) * 4;
    assert.ok(output.data[ink + 2] - output.data[ink] > 60, 'Blue ink should stay blue');
  } finally { input.delete(); output.delete(); }
});
