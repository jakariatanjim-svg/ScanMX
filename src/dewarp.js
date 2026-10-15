/**
 * Straighten wavy or curved text.
 *
 * A page bent by a fold or curled at the edge makes its text lines drift up and
 * down (or left and right). We measure that drift strip by strip: each narrow
 * strip of the page gives a row profile of its ink, and neighbouring strips are
 * aligned by their best cross-correlation. The accumulated shifts become two
 * displacement maps that remap the page so the lines run straight.
 *
 * Measurement runs on a small copy of the page to keep it fast on phones. A flat
 * page (no significant drift) returns null, so it is never altered.
 */

const WORK_WIDTH = 480;       // width of the measurement copy, in pixels
const STRIP = 10;             // strip width in measurement pixels
const STRIP_STEP = 5;         // strips overlap by half, for smoother tracking
const MAX_STEP_SHIFT = 4;     // largest allowed change between neighbouring strips
const MIN_CORRELATION = 0.35; // below this, two strips are treated as unrelated
const MIN_SHIFT = 1.5;        // total drift (measurement pixels) needed to act
const MAX_SHIFT_RATIO = 0.08; // never move a line more than 8% of the page height/width

function median3(values, index) {
  const a = values[Math.max(0, index - 1)];
  const b = values[index];
  const c = values[Math.min(values.length - 1, index + 1)];
  return a + b + c - Math.max(a, b, c) - Math.min(a, b, c);
}

function smooth3(values) {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const a = values[Math.max(0, i - 1)];
    const c = values[Math.min(values.length - 1, i + 1)];
    out[i] = (a + values[i] + c) / 3;
  }
  return out;
}

/** Shift d that best satisfies A(y) ~ B(y - d), with a small search window. */
function bestShift(a, b) {
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA < 1e-6 || normB < 1e-6) return 0;
  const norm = Math.sqrt(normA * normB);
  let best = 0;
  let bestScore = -Infinity;
  for (let d = -MAX_STEP_SHIFT; d <= MAX_STEP_SHIFT; d++) {
    let sum = 0;
    for (let y = Math.max(0, d); y < Math.min(a.length, b.length + d); y++) sum += a[y] * b[y - d];
    const score = sum / norm - 0.002 * Math.abs(d); // prefer small moves on ties
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore >= MIN_CORRELATION ? best : 0;
}

/**
 * Cumulative vertical shift for each column (measurement pixels), or null when
 * the page is effectively flat along this direction.
 */
function shiftsAlong(mask, width, height) {
  const centers = [];
  for (let c = STRIP / 2; c + STRIP / 2 <= width; c += STRIP_STEP) centers.push(c);
  if (centers.length < 6) return null;

  const profiles = centers.map((center) => {
    const profile = new Float32Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      for (let x = center - STRIP / 2; x < center + STRIP / 2; x++) sum += mask[y * width + x] ? 1 : 0;
      profile[y] = sum;
    }
    return smooth3(profile);
  });

  const n = centers.length;
  const middle = n >> 1;
  const offsets = new Float32Array(n);
  // Track outward from the central strip so drift is measured against the most
  // reliable part of the page and does not accumulate from one edge.
  for (let k = middle + 1; k < n; k++) offsets[k] = offsets[k - 1] + bestShift(profiles[k], profiles[k - 1]);
  for (let k = middle - 1; k >= 0; k--) offsets[k] = offsets[k + 1] + bestShift(profiles[k], profiles[k + 1]);

  const cleaned = new Float32Array(n);
  let largest = 0;
  const limit = height * MAX_SHIFT_RATIO;
  for (let k = 0; k < n; k++) {
    cleaned[k] = Math.max(-limit, Math.min(limit, median3(offsets, k)));
    largest = Math.max(largest, Math.abs(cleaned[k]));
  }
  if (largest < MIN_SHIFT) return null;

  const full = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    if (x <= centers[0]) full[x] = cleaned[0];
    else if (x >= centers[n - 1]) full[x] = cleaned[n - 1];
    else {
      let k = 0;
      while (k < n - 2 && centers[k + 1] < x) k++;
      const t = (x - centers[k]) / (centers[k + 1] - centers[k]);
      full[x] = cleaned[k] * (1 - t) + cleaned[k + 1] * t;
    }
  }
  return full;
}

function sampleAt(values, index, count) {
  const position = Math.max(0, Math.min(values.length - 1, (index + 0.5) * values.length / count - 0.5));
  const low = Math.floor(position);
  const high = Math.min(values.length - 1, low + 1);
  const t = position - low;
  return values[low] * (1 - t) + values[high] * t;
}

/**
 * Returns { mapX, mapY } (CV_32FC1, full size) for cv.remap, or null when the
 * page is already straight. The caller owns and must delete both maps.
 */
export function computeStraightenMaps(cv, rgba) {
  const width = rgba.cols;
  const height = rgba.rows;
  const smallWidth = Math.min(WORK_WIDTH, width);
  const smallHeight = Math.max(16, Math.round(height * smallWidth / width));
  const small = new cv.Mat();
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  try {
    cv.resize(rgba, small, new cv.Size(smallWidth, smallHeight), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
    let block = Math.max(11, Math.round(Math.min(smallWidth, smallHeight) * 0.08));
    if (block % 2 === 0) block += 1;
    // Text and ruled lines are darker than the local paper; adaptive threshold ignores
    // the slow fold shadow that a global threshold would mistake for ink.
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 10);
    const mask = Uint8Array.from(binary.data);

    const columnShifts = shiftsAlong(mask, smallWidth, smallHeight);
    const transposed = new Uint8Array(mask.length);
    for (let y = 0; y < smallHeight; y++) {
      for (let x = 0; x < smallWidth; x++) transposed[x * smallHeight + y] = mask[y * smallWidth + x];
    }
    const rowShifts = shiftsAlong(transposed, smallHeight, smallWidth);
    if (!columnShifts && !rowShifts) return null;

    // Columns drift vertically (bent text lines); rows drift horizontally (vertical bends).
    const columnFull = new Float32Array(width);
    const rowFull = new Float32Array(height);
    for (let x = 0; x < width; x++) columnFull[x] = columnShifts ? sampleAt(columnShifts, x * smallWidth / width, smallWidth) * height / smallHeight : 0;
    for (let y = 0; y < height; y++) rowFull[y] = rowShifts ? sampleAt(rowShifts, y * smallHeight / height, smallHeight) * width / smallWidth : 0;

    const mapX = new cv.Mat(height, width, cv.CV_32FC1);
    const mapY = new cv.Mat(height, width, cv.CV_32FC1);
    const xs = mapX.data32F;
    const ys = mapY.data32F;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        xs[y * width + x] = x + rowFull[y];
        ys[y * width + x] = y + columnFull[x];
      }
    }
    return { mapX, mapY };
  } finally {
    small.delete();
    gray.delete();
    binary.delete();
  }
}
