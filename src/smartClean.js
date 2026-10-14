/**
 * Smart clean ("magic" document filter).
 *
 * 1. Estimate the paper itself: a grayscale-style morphological dilation removes
 *    dark ink and thin strokes, then a wide blur turns what remains into a smooth
 *    map of the paper's brightness and tint. Fold shadows and uneven lighting
 *    show up in this map because they are broad, while text does not.
 * 2. Divide every colour channel by that map. The paper becomes neutral white,
 *    fold shadows disappear, and coloured ink keeps its hue.
 * 3. Auto-level: a black point is taken from the darkest ink in the page, and the
 *    result is stretched so that paper is white and text is crisp.
 * 4. Blend by the cleanup strength and add a light unsharp mask for text edges.
 *
 * Everything runs locally on a bounded working size, so it stays practical on
 * phones. This removes lighting problems; it does not dewarp curved pages or
 * reconstruct text that the camera never captured.
 */

const BACKGROUND_MAX_EDGE = 480;
const MIN_PAPER_LEVEL = 40;     // stops deep shadows from amplifying sensor noise
const PAPER_WHITE_POINT = 235;  // values at or above this become pure white
const MAX_BLACK_POINT = 110;    // never lift the black point so far that text fades
const MIN_LEVEL_RANGE = 80;     // minimum tonal span used when stretching levels

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Smooth estimate of the paper colour at every pixel, at full input resolution.
 * A median over a window wider than the text line spacing ignores ink (which
 * covers well under half of the window) and, unlike a max filter, does not
 * drift toward brighter neighbours on a smooth fold shadow.
 */
function estimatePaper(cv, rgb, mat) {
  const scale = Math.min(1, BACKGROUND_MAX_EDGE / Math.max(rgb.cols, rgb.rows));
  const small = mat();
  cv.resize(rgb, small, new cv.Size(Math.max(1, Math.round(rgb.cols * scale)), Math.max(1, Math.round(rgb.rows * scale))), 0, 0, cv.INTER_AREA);

  let windowSize = Math.max(5, Math.round(Math.min(small.cols, small.rows) * 0.06));
  if (windowSize % 2 === 0) windowSize += 1;
  const median = mat();
  cv.medianBlur(small, median, windowSize);
  const paperMap = mat();
  cv.GaussianBlur(median, paperMap, new cv.Size(0, 0), Math.max(1, windowSize / 4), 0, cv.BORDER_REPLICATE);
  const fullSize = mat();
  cv.resize(paperMap, fullSize, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
  return fullSize;
}

/** Black point from the darkest ~0.4% of luminance, so text reaches true black. */
function blackPoint(levels, pixels) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < pixels; index++) {
    const offset = index * 3;
    histogram[(levels[offset] * 77 + levels[offset + 1] * 150 + levels[offset + 2] * 29) >> 8] += 1;
  }
  const target = pixels * 0.004;
  let accumulated = 0;
  let point = 0;
  while (point < 255 && accumulated < target) {
    accumulated += histogram[point];
    point += 1;
  }
  // Keep at least MIN_LEVEL_RANGE between black and white, so a blank or faint page never divides by zero.
  return Math.min(point, MAX_BLACK_POINT, PAPER_WHITE_POINT - MIN_LEVEL_RANGE);
}

export function smartClean(cv, input, settings = {}) {
  const resources = [];
  const mat = () => {
    const value = new cv.Mat();
    resources.push(value);
    return value;
  };
  let result;
  try {
    const cleanup = Number.isFinite(Number(settings.cleanup)) ? Number(settings.cleanup) : 80;
    const strength = clamp(cleanup, 0, 100) / 100;
    // Ease the blend so the default (80%) already gives clean white paper, while
    // the slider still runs smoothly from the untouched photo (0) to full clean (100).
    const blend = 1 - (1 - strength) ** 2;
    const exposure = clamp(Number(settings.exposure) || 0, -30, 30);
    const width = input.cols;
    const height = input.rows;
    const pixels = width * height;

    const rgb = mat();
    cv.cvtColor(input, rgb, cv.COLOR_RGBA2RGB);
    // Pass 1 estimates the paper; pass 2 re-estimates it on the flattened page,
    // which removes the small residual that a single dilation leaves in the
    // centre of a deep fold (dilation is biased toward brighter neighbours).
    const first = estimatePaper(cv, rgb, mat);
    const color = rgb.data;
    const firstLevels = first.data;
    const flatFirst = new Uint8ClampedArray(pixels * 3);
    for (let index = 0; index < flatFirst.length; index++) {
      flatFirst[index] = Math.min(255, (color[index] * 255) / Math.max(MIN_PAPER_LEVEL, firstLevels[index]));
    }
    const flatMat = mat();
    flatMat.create(height, width, cv.CV_8UC3);
    flatMat.data.set(flatFirst);
    const second = estimatePaper(cv, flatMat, mat);

    const secondLevels = second.data;
    const flat = new Uint8ClampedArray(pixels * 3);
    for (let index = 0; index < flat.length; index++) {
      const paperLevel = (firstLevels[index] * secondLevels[index]) / 255;
      flat[index] = Math.min(255, (color[index] * 255) / Math.max(MIN_PAPER_LEVEL, paperLevel));
    }

    // Pass 2: auto-level and blend with the original by the cleanup strength.
    const black = blackPoint(flat, pixels);
    const scale = 255 / (PAPER_WHITE_POINT - black);
    const original = input.data;
    const processed = new cv.Mat(height, width, cv.CV_8UC4);
    resources.push(processed);
    const output = processed.data;
    for (let pixel = 0; pixel < pixels; pixel++) {
      for (let channel = 0; channel < 3; channel++) {
        const leveled = clamp((flat[pixel * 3 + channel] - black) * scale, 0, 255);
        const source = original[pixel * 4 + channel];
        output[pixel * 4 + channel] = clamp(source * (1 - blend) + leveled * blend + exposure, 0, 255);
      }
      output[pixel * 4 + 3] = 255;
    }

    // Light unsharp mask keeps stroke edges crisp without haloing the paper.
    const soft = mat();
    const sharpened = mat();
    cv.GaussianBlur(processed, soft, new cv.Size(0, 0), 0.8);
    cv.addWeighted(processed, 1 + 0.35 * strength, soft, -0.35 * strength, 0, sharpened);
    result = sharpened;
    return result;
  } finally {
    resources.forEach((resource) => { if (resource !== result) resource.delete(); });
  }
}
