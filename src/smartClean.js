/**
 * Smart clean ("magic" document filter).
 *
 * Paper pages:
 * 1. Estimate the paper with a median filter wider than the line spacing. Ink covers
 *    well under half of that window, so the estimate follows broad fold shadows and
 *    uneven light, but not the text.
 * 2. Re-estimate on the flattened page to remove the small residual in a deep fold.
 * 3. Divide every colour channel by the paper map: paper becomes neutral white and
 *    coloured ink keeps its hue.
 * 4. Optionally erase ruled lines ("Text only") — long straight strokes — while text
 *    shapes are left alone.
 * 5. Auto-level, deepen the text with a gamma curve, and boost ink colour.
 *
 * Coloured documents (ID cards, photos, coloured forms):
 * Dividing by a paper map would wash out colour fields, so these skip the paper
 * step and the ink curve. Only a tonal stretch is applied, which keeps their colours.
 *
 * Everything runs locally on a bounded working size, so it stays practical on phones.
 */

const BACKGROUND_MAX_EDGE = 480;
const MIN_PAPER_LEVEL = 40;     // stops deep shadows from amplifying sensor noise
const PAPER_WHITE_POINT = 235;  // values at or above this become pure white
const MAX_BLACK_POINT = 110;    // never lift the black point so far that text fades
const MIN_LEVEL_RANGE = 80;     // minimum tonal span used when stretching levels
const INK_GAMMA = 1.35;         // > 1 deepens anti-aliased and light strokes
const INK_CHROMA = 1.2;         // > 1 makes coloured ink more vivid
const LINE_MARK_LEVEL = 235;    // anything darker than this may be part of a ruled line
const COLOR_PIXEL_SPREAD = 60;  // max(r,g,b) - min(r,g,b) above this counts as coloured
const COLOR_DOCUMENT_RATIO = 0.06; // share of coloured pixels that switches to the colour-safe path

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Smooth estimate of the paper colour at every pixel, at full input resolution.
 * A median over a window wider than the text line spacing ignores ink and, unlike
 * a max filter, does not drift toward brighter neighbours on a smooth fold shadow.
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

/** Share of pixels that are clearly coloured (not paper, not ink). */
function colorShare(color, pixels) {
  let colored = 0;
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 3;
    const r = color[offset];
    const g = color[offset + 1];
    const b = color[offset + 2];
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread > COLOR_PIXEL_SPREAD) colored += 1;
  }
  return colored / Math.max(1, pixels);
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

/**
 * "Text only": erase long, straight strokes (ruled lines and table borders) from
 * the flattened RGB page. Long horizontal and vertical runs are found by
 * morphological opening; handwriting strokes are too short to form such runs.
 */
function removeRuledLines(cv, levels, width, height, mat) {
  const page = mat();
  page.create(height, width, cv.CV_8UC3);
  page.data.set(levels);
  const gray = mat();
  cv.cvtColor(page, gray, cv.COLOR_RGB2GRAY);
  const marks = mat();
  cv.threshold(gray, marks, LINE_MARK_LEVEL, 255, cv.THRESH_BINARY_INV);

  const horizontal = mat();
  const vertical = mat();
  const runH = Math.max(31, Math.round(width * 0.05));
  const runV = Math.max(31, Math.round(height * 0.05));
  const kernelH = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(runH, 1));
  const kernelV = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, runV));
  try {
    cv.morphologyEx(marks, horizontal, cv.MORPH_OPEN, kernelH);
    cv.morphologyEx(marks, vertical, cv.MORPH_OPEN, kernelV);
  } finally {
    kernelH.delete();
    kernelV.delete();
  }
  const lines = mat();
  cv.bitwise_or(horizontal, vertical, lines);
  const grown = mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  try {
    cv.dilate(lines, grown, kernel);
  } finally {
    kernel.delete();
  }

  const lineData = grown.data;
  const grayData = gray.data;
  for (let index = 0; index < width * height; index++) {
    if (!lineData[index]) continue;
    levels[index * 3] = 255;
    levels[index * 3 + 1] = 255;
    levels[index * 3 + 2] = 255;
  }
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
    const keepLines = settings.keepLines !== false;
    const width = input.cols;
    const height = input.rows;
    const pixels = width * height;

    const rgb = mat();
    cv.cvtColor(input, rgb, cv.COLOR_RGBA2RGB);
    const color = rgb.data;
    const colorful = colorShare(color, pixels) > COLOR_DOCUMENT_RATIO;

    // Flattened RGB page. Paper pages are whitened; coloured documents keep their tones.
    const flat = new Uint8ClampedArray(pixels * 3);
    if (colorful) {
      flat.set(color);
    } else {
      // Pass 1 estimates the paper; pass 2 re-estimates it on the flattened page,
      // which removes the small residual that a single estimate leaves in a deep fold.
      const first = estimatePaper(cv, rgb, mat);
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
      for (let index = 0; index < flat.length; index++) {
        const paperLevel = (firstLevels[index] * secondLevels[index]) / 255;
        flat[index] = Math.min(255, (color[index] * 255) / Math.max(MIN_PAPER_LEVEL, paperLevel));
      }
    }

    // "Keep lines" leaves the page structure as it is; "Text only" erases the rules.
    if (!keepLines && !colorful) removeRuledLines(cv, flat, width, height, mat);

    // Auto-level, deepen ink (paper pages only), and blend with the original.
    const black = blackPoint(flat, pixels);
    const scale = 255 / (PAPER_WHITE_POINT - black);
    const gamma = colorful ? 1 : INK_GAMMA;
    const chroma = colorful ? 1 : INK_CHROMA;
    const inkLut = new Uint8ClampedArray(256);
    for (let value = 0; value < 256; value++) {
      const leveled = clamp((value - black) * scale, 0, 255) / 255;
      inkLut[value] = 255 * leveled ** gamma;
    }
    const original = input.data;
    const processed = new cv.Mat(height, width, cv.CV_8UC4);
    resources.push(processed);
    const output = processed.data;
    for (let pixel = 0; pixel < pixels; pixel++) {
      const r = inkLut[flat[pixel * 3]];
      const g = inkLut[flat[pixel * 3 + 1]];
      const b = inkLut[flat[pixel * 3 + 2]];
      // Boost colour away from the luminance: neutral paper and black text are unchanged.
      const luma = 0.3 * r + 0.59 * g + 0.11 * b;
      const boostedR = clamp(luma + (r - luma) * chroma, 0, 255);
      const boostedG = clamp(luma + (g - luma) * chroma, 0, 255);
      const boostedB = clamp(luma + (b - luma) * chroma, 0, 255);
      const offset = pixel * 4;
      output[offset] = clamp(original[offset] * (1 - blend) + boostedR * blend + exposure, 0, 255);
      output[offset + 1] = clamp(original[offset + 1] * (1 - blend) + boostedG * blend + exposure, 0, 255);
      output[offset + 2] = clamp(original[offset + 2] * (1 - blend) + boostedB * blend + exposure, 0, 255);
      output[offset + 3] = 255;
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
