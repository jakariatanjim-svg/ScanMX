import test from 'node:test';
import assert from 'node:assert/strict';
import cvModule from '@techstark/opencv-js';
import { detectPageMat } from '../src/scanEngine.js';
import { isValidQuad } from '../src/geometry.js';

const cv = await cvModule;
const expected = [{ x: 90, y: 70 }, { x: 510, y: 110 }, { x: 550, y: 700 }, { x: 60, y: 740 }];

function pageFixture(background, paper, frame = false, shadow = false) {
  const image = new cv.Mat(800, 600, cv.CV_8UC4, new cv.Scalar(background, background, background, 255));
  const points = cv.matFromArray(4, 1, cv.CV_32SC2, expected.flatMap(({ x, y }) => [x, y]));
  try {
    cv.fillConvexPoly(image, points, new cv.Scalar(paper, paper, paper, 255));
    for (let y = 160; y < 650; y += 30) cv.line(image, new cv.Point(140, y), new cv.Point(450, y), new cv.Scalar(35, 35, 35, 255), 3);
    if (shadow) {
      for (let y = 0; y < image.rows; y++) {
        for (let x = 0; x < image.cols; x++) {
          const factor = (0.65 + 0.35 * x / image.cols) * (1 - 0.25 * Math.exp(-(((x - 310) / 30) ** 2)));
          const i = (y * image.cols + x) * 4;
          for (let channel = 0; channel < 3; channel++) image.data[i + channel] *= factor;
        }
      }
    }
    if (frame) cv.rectangle(image, new cv.Point(1, 1), new cv.Point(598, 798), new cv.Scalar(250, 250, 250, 255), 3);
    return image;
  } finally { points.delete(); }
}

for (const fixture of [
  { name: 'perspective page', background: 50, paper: 235 },
  { name: 'low-contrast paper', background: 180, paper: 205 },
  { name: 'dark paper on a light desk', background: 230, paper: 95 },
  { name: 'document inside a camera-border contour', background: 70, paper: 240, frame: true },
  { name: 'uneven lighting and a fold shadow', background: 50, paper: 235, shadow: true },
]) {
  test(`auto-crop locates ${fixture.name}`, () => {
    const source = pageFixture(fixture.background, fixture.paper, fixture.frame, fixture.shadow);
    try {
      const result = detectPageMat(source, cv);
      assert.equal(result.detected, true);
      assert.ok(isValidQuad(result.corners));
      result.corners.forEach((point, index) => {
        const error = Math.hypot(point.x - expected[index].x, point.y - expected[index].y);
        assert.ok(error < 12, `Corner ${index} is ${error.toFixed(1)} pixels away: ${JSON.stringify(result.corners)}`);
      });
    } finally { source.delete(); }
  });
}

test('uncertain detection keeps the whole image rather than inventing a crop', () => {
  const source = new cv.Mat(300, 400, cv.CV_8UC4, new cv.Scalar(220, 220, 220, 255));
  try {
    const result = detectPageMat(source, cv);
    assert.equal(result.detected, false);
    assert.deepEqual(result.corners, [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]);
  } finally { source.delete(); }
});

test('crop validation rejects crossed, collapsed, reversed and non-finite corners', () => {
  assert.ok(isValidQuad(expected));
  assert.equal(isValidQuad([expected[0], expected[2], expected[1], expected[3]]), false);
  assert.equal(isValidQuad([expected[0], expected[0], expected[2], expected[3]]), false);
  assert.equal(isValidQuad([...expected].reverse()), false);
  assert.equal(isValidQuad([{ x: NaN, y: 0 }, ...expected.slice(1)]), false);
  assert.equal(isValidQuad(null), false);
});

test('a folded or curved page still yields a usable four-corner crop', () => {
  // The top edge bulges like a page that is bent or curled by a fold.
  const source = new cv.Mat(800, 600, cv.CV_8UC4, new cv.Scalar(50, 50, 50, 255));
  const outline = [];
  for (let step = 0; step <= 16; step++) {
    const t = step / 16;
    outline.push({ x: Math.round(90 + (510 - 90) * t), y: Math.round(70 + (110 - 70) * t - 40 * Math.sin(Math.PI * t)) });
  }
  outline.push({ x: 550, y: 700 }, { x: 60, y: 740 });
  const points = cv.matFromArray(outline.length, 1, cv.CV_32SC2, outline.flatMap(({ x, y }) => [x, y]));
  try {
    cv.fillConvexPoly(source, points, new cv.Scalar(235, 235, 235, 255));
    for (let y = 160; y < 650; y += 30) cv.line(source, new cv.Point(140, y), new cv.Point(450, y), new cv.Scalar(35, 35, 35, 255), 3);
    const result = detectPageMat(source, cv);
    assert.equal(result.detected, true);
    assert.ok(isValidQuad(result.corners));
    const xs = result.corners.map((point) => point.x);
    const ys = result.corners.map((point) => point.y);
    assert.ok(Math.min(...xs) < 110 && Math.max(...xs) > 490, `Crop should span the page width: ${JSON.stringify(result.corners)}`);
    assert.ok(Math.min(...ys) < 110 && Math.max(...ys) > 680, `Crop should span the page height: ${JSON.stringify(result.corners)}`);
  } finally { points.delete(); source.delete(); }
});
