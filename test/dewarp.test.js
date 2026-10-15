import test from 'node:test';
import assert from 'node:assert/strict';
import cvModule from '@techstark/opencv-js';
import { computeStraightenMaps } from '../src/dewarp.js';

const cv = await cvModule;
const W = 800;
const H = 1000;

/** Text-like horizontal lines whose vertical position waves along x, as on a bent page. */
function wavyPage(amplitude) {
  const page = new cv.Mat(H, W, cv.CV_8UC4, new cv.Scalar(240, 240, 240, 255));
  for (let k = 0; k < 10; k++) {
    const y0 = 150 + k * 70;
    for (let x = 60; x < 740; x += 4) {
      const y = Math.round(y0 + amplitude * Math.sin((2 * Math.PI * x) / 700));
      cv.line(page, new cv.Point(x, y), new cv.Point(x + 4, Math.round(y0 + amplitude * Math.sin((2 * Math.PI * (x + 4)) / 700))), new cv.Scalar(40, 40, 40, 255), 3);
    }
  }
  return page;
}

/** Vertical centre of the ink of one text line at a given column. */
function lineCentre(mat, x, y0) {
  let weight = 0;
  let sum = 0;
  for (let y = y0 - 35; y < y0 + 35; y++) {
    const darkness = Math.max(0, 150 - mat.data[(y * mat.cols + x) * 4]); // ink only, not paper
    weight += darkness;
    sum += darkness * y;
  }
  return sum / weight;
}

test('bent text lines are straightened by remapping the page', () => {
  const source = wavyPage(14);
  const maps = computeStraightenMaps(cv, source);
  assert.ok(maps, 'A wavy page should produce correction maps');
  const straight = new cv.Mat();
  try {
    cv.remap(source, straight, maps.mapX, maps.mapY, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const y0 = 150 + 3 * 70;
    const before = Math.abs(lineCentre(source, 100, y0) - lineCentre(source, 700, y0));
    const after = Math.abs(lineCentre(straight, 100, y0) - lineCentre(straight, 700, y0));
    assert.ok(before > 10, `Fixture should be visibly wavy: ${before.toFixed(1)}px`);
    assert.ok(after < before * 0.4, `Line should be flatter after straightening: ${before.toFixed(1)}px -> ${after.toFixed(1)}px`);
  } finally {
    source.delete();
    straight.delete();
    maps.mapX.delete();
    maps.mapY.delete();
  }
});

test('a flat page is left alone', () => {
  const flat = wavyPage(0);
  try {
    assert.equal(computeStraightenMaps(cv, flat), null);
  } finally {
    flat.delete();
  }
});
