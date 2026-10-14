import cvModule from '@techstark/opencv-js';
import { smartClean } from './smartClean.js';
import { isValidQuad } from './geometry.js';
import { computeStraightenMaps } from './dewarp.js';

let cvPromise;

export function getOpenCv() {
  if (!cvPromise) {
    if (cvModule && typeof cvModule.then === 'function') {
      cvPromise = cvModule;
    } else if (cvModule?.Mat) {
      cvPromise = Promise.resolve(cvModule);
    } else {
      cvPromise = new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('The local scan engine did not finish starting.')), 30000);
        cvModule.onRuntimeInitialized = () => {
          window.clearTimeout(timeout);
          resolve(cvModule);
        };
        cvModule.onAbort = (reason) => {
          window.clearTimeout(timeout);
          reject(new Error(String(reason || 'The local scan engine could not start.')));
        };
      });
    }
  }
  return cvPromise;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened by your browser.'));
    image.src = url;
    if (image.complete && image.naturalWidth) resolve(image);
  });
}

function fitCanvas(image, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return { canvas, width, height, scale };
}

function orderCorners(points) {
  const sums = points.map((point) => point.x + point.y);
  const diffs = points.map((point) => point.x - point.y);
  const topLeft = points[sums.indexOf(Math.min(...sums))];
  const bottomRight = points[sums.indexOf(Math.max(...sums))];
  const topRight = points[diffs.indexOf(Math.max(...diffs))];
  const bottomLeft = points[diffs.indexOf(Math.min(...diffs))];
  const ordered = [topLeft, topRight, bottomRight, bottomLeft];
  if (new Set(ordered).size !== 4) {
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
    const around = [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    const start = around.reduce((best, point, index) => (point.x + point.y < around[best].x + around[best].y ? index : best), 0);
    const rotated = [...around.slice(start), ...around.slice(0, start)];
    return [rotated[0], rotated[1], rotated[2], rotated[3]];
  }
  return ordered;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

/** Corners of a rotated rectangle, used when a page is folded or curved. */
function rectangleCorners(rect) {
  const theta = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const halfWidth = rect.size.width / 2;
  const halfHeight = rect.size.height / 2;
  return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
    x: rect.center.x + x * cos - y * sin,
    y: rect.center.y + x * sin + y * cos,
  }));
}

function contourPoints(contour) {
  const points = [];
  for (let index = 0; index < contour.rows; index += 1) {
    points.push({ x: contour.data32S[index * 2], y: contour.data32S[index * 2 + 1] });
  }
  return points;
}

function intersectLines(first, second) {
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const denominator = cross(first.dir.x, first.dir.y, second.dir.x, second.dir.y);
  if (Math.abs(denominator) < 1e-6) return null;
  const offsetX = second.point.x - first.point.x;
  const offsetY = second.point.y - first.point.y;
  const t = cross(offsetX, offsetY, second.dir.x, second.dir.y) / denominator;
  return { x: first.point.x + t * first.dir.x, y: first.point.y + t * first.dir.y };
}

/**
 * Snap each side of the quadrilateral to the contour points that lie along it
 * (total least squares), then move each corner to where its two sides meet.
 * This follows the real paper edge, so corners land on the true page corners
 * instead of the nearest coarse polygon vertex. Falls back to the original quad.
 */
function refineQuad(points, outline) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const sides = [];
  for (let index = 0; index < 4; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % 4];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 2) {
      sides.push(null);
      continue;
    }
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;
    const nx = -uy;
    const ny = ux;
    const tolerance = Math.max(2, diagonal * 0.025);
    const near = outline.filter((point) => {
      const along = (point.x - start.x) * ux + (point.y - start.y) * uy;
      if (along < -0.1 * length || along > 1.1 * length) return false;
      return Math.abs((point.x - start.x) * nx + (point.y - start.y) * ny) <= tolerance;
    });
    if (near.length < 12) {
      sides.push(null);
      continue;
    }
    const meanX = near.reduce((sum, point) => sum + point.x, 0) / near.length;
    const meanY = near.reduce((sum, point) => sum + point.y, 0) / near.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const point of near) {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    sides.push({ point: { x: meanX, y: meanY }, dir: { x: Math.cos(angle), y: Math.sin(angle) } });
  }

  const refined = points.map((point) => ({ ...point }));
  for (let index = 0; index < 4; index += 1) {
    const previous = sides[(index + 3) % 4];
    const next = sides[index];
    if (!previous || !next) continue;
    const hit = intersectLines(previous, next);
    // Only accept small corrections; a large jump means the sides were misread.
    if (hit && Math.hypot(hit.x - points[index].x, hit.y - points[index].y) <= diagonal * 0.12) refined[index] = hit;
  }
  return isValidQuad(refined) ? refined : points;
}

function contourCandidates(cv, source, minArea) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const candidates = [];
  try {
    cv.findContours(source, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    for (let index = 0; index < contours.size(); index += 1) {
      const contour = contours.get(index);
      const area = cv.contourArea(contour);
      if (area < minArea) {
        contour.delete();
        continue;
      }
      const perimeter = cv.arcLength(contour, true);
      const outline = contourPoints(contour);
      let foundQuad = false;
      for (const epsilon of [0.012, 0.018, 0.025, 0.035, 0.05]) {
        const approximation = new cv.Mat();
        cv.approxPolyDP(contour, approximation, epsilon * perimeter, true);
        if (approximation.rows === 4 && cv.isContourConvex(approximation)) {
          const raw = [];
          for (let point = 0; point < 4; point += 1) {
            raw.push({ x: approximation.data32S[point * 2], y: approximation.data32S[point * 2 + 1] });
          }
          const points = refineQuad(orderCorners(raw), outline);
          const quadArea = polygonArea(points);
          const ratio = quadArea / area;
          if (ratio > 0.68 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
            candidates.push({ points, area: quadArea, ratio });
            foundQuad = true;
          }
        }
        approximation.delete();
      }
      if (!foundQuad) {
        // Folded or curved pages rarely form a clean quadrilateral. Their
        // minimum-area rectangle still bounds the page well, so keep it as a
        // lower-priority candidate that a true quadrilateral can beat.
        const rect = cv.minAreaRect(contour);
        const points = orderCorners(rectangleCorners(rect));
        const quadArea = polygonArea(points);
        const ratio = quadArea / area;
        if (ratio >= 1 && ratio < 1.3 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
          candidates.push({ points, area: quadArea, ratio, penalty: 0.85 });
        }
      }
      contour.delete();
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return candidates;
}

/**
 * A page that already fills the frame (a flat scan or a tight crop) has paper at
 * every border and no dark background. Its border is the page edge, so the
 * whole frame is the answer; table rules or lines inside it must not be used.
 */
function inspectFrame(data, width, height) {
  const ring = Math.max(4, Math.round(Math.min(width, height) * 0.02));
  const borderValues = [];
  const innerValues = [];
  let innerInk = 0;
  let innerCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[y * width + x];
      const onRing = x < ring || y < ring || x >= width - ring || y >= height - ring;
      if (onRing) {
        borderValues.push(value);
      } else {
        innerCount += 1;
        if (value <= 110) innerInk += 1;
        if ((x + y) % 7 === 0) innerValues.push(value);
      }
    }
  }
  const median = (values) => {
    const sorted = Uint8Array.from(values).sort();
    return sorted[sorted.length >> 1];
  };
  const borderMedian = median(borderValues);
  const innerMedian = median(innerValues);
  const borderDark = borderValues.filter((value) => value <= 110).length / borderValues.length;
  // Paper at the border that matches the paper inside (same tone, no dark desk).
  // A light desk around a grey page differs from the page inside, so it is excluded.
  if (borderMedian < 170 || Math.abs(borderMedian - innerMedian) > 12 || borderDark > 0.03) return null;
  const inkRatio = innerInk / Math.max(1, innerCount);
  return {
    corners: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
    detected: inkRatio >= 0.002 && inkRatio <= 0.4,
    confidence: 1,
  };
}

/**
 * Average brightness step across the four sides of a candidate page: the inside
 * of a real page edge is clearly different from the outside. Table rules inside a
 * white page have the same tone on both sides, so they score near zero.
 */
function sideContrast(data, width, height, points) {
  const sample = (x, y) => {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    return data[py * width + px];
  };
  const centerX = points.reduce((sum, point) => sum + point.x, 0) / 4;
  const centerY = points.reduce((sum, point) => sum + point.y, 0) / 4;
  let total = 0;
  let sides = 0;
  for (let index = 0; index < 4; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % 4];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 8) continue;
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;
    let nx = -uy;
    let ny = ux;
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;
    if ((midX - centerX) * nx + (midY - centerY) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let sum = 0;
    let count = 0;
    for (let t = 0.15; t <= 0.851; t += 0.1) {
      const px = start.x + ux * length * t;
      const py = start.y + uy * length * t;
      const inside = sample(px - nx * 5, py - ny * 5);
      const outside = sample(px + nx * 5, py + ny * 5);
      if (inside === null || outside === null) continue;
      sum += inside - outside;
      count += 1;
    }
    if (count >= 4) {
      total += sum / count;
      sides += 1;
    }
  }
  return sides ? total / sides : null;
}

/** Detect on a bounded RGBA image. No DOM dependency, so fixtures can test the real engine. */
export function detectPageMat(source, cv) {
  const width = source.cols;
  const height = source.rows;
  const totalArea = width * height;
  const resources = [];
  const mat = () => {
    const value = new cv.Mat();
    resources.push(value);
    return value;
  };
  try {
    const gray = mat();
    const blurred = mat();
    const balanced = mat();
    const edges = mat();
    const closed = mat();
    const binary = mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    resources.push(kernel);
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    const framed = inspectFrame(gray.data, width, height);
    if (framed) return framed;
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    const clahe = new cv.CLAHE(2, new cv.Size(8, 8));
    resources.push(clahe);
    clahe.apply(blurred, balanced);
    const candidates = [];
    const collect = (mask) => {
      // Close small gaps without inflating every edge and moving the crop out.
      cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, kernel);
      candidates.push(...contourCandidates(cv, closed, totalArea * 0.12));
    };
    // Complementary passes handle low contrast, dark paper, and uneven lighting.
    // Always evaluate alternatives: an image-border contour must not suppress
    // detection of a real document in a later pass.
    for (const [input, low, high] of [[blurred, 35, 115], [balanced, 15, 60]]) {
      cv.Canny(input, edges, low, high);
      collect(edges);
    }
    for (const polarity of [cv.THRESH_BINARY, cv.THRESH_BINARY_INV]) {
      cv.threshold(blurred, binary, 0, 255, polarity + cv.THRESH_OTSU);
      collect(binary);
    }

    const usable = candidates.filter(({ points, area, ratio }) => {
      if (!isValidQuad(points) || area >= totalArea * 0.985 || ratio < 0.75 || ratio > 1.25) return false;
      // Reject the camera frame, but allow a real page to touch one/two edges.
      const border = Math.max(3, Math.min(width, height) * 0.012);
      const touches = points.filter((p) => p.x <= border || p.y <= border || p.x >= width - 1 - border || p.y >= height - 1 - border).length;
      if (touches >= 3) return false;
      const contrast = sideContrast(gray.data, width, height, points);
      if (contrast !== null && Math.abs(contrast) < 10) return false;
      return points.every((point, i) => {
        const before = points[(i + 3) % 4];
        const after = points[(i + 1) % 4];
        const a = { x: before.x - point.x, y: before.y - point.y };
        const b = { x: after.x - point.x, y: after.y - point.y };
        const cosine = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
        return Math.abs(cosine) < 0.94;
      });
    }).map((candidate) => ({
      ...candidate,
      score: candidate.area / totalArea * Math.min(candidate.ratio, 1 / candidate.ratio) * (candidate.penalty || 1) * Math.min(1, Math.abs(sideContrast(gray.data, width, height, candidate.points) ?? 40) / 40),
    })).sort((a, b) => b.score - a.score);

    const best = usable[0];
    return best ? { corners: best.points, detected: true, confidence: best.score } : {
      corners: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }],
      detected: false,
      confidence: 0,
    };
  } finally {
    resources.forEach((resource) => resource.delete());
  }
}

/** Auto-crop on import; preserve the full photograph when no reliable outline exists. */
export function detectPage(image, cv) {
  const { canvas, width, height } = fitCanvas(image, 1200);
  const source = cv.imread(canvas);
  try {
    const result = detectPageMat(source, cv);
    return {
      ...result,
      corners: result.corners.map((point) => ({
        x: point.x * image.naturalWidth / width,
        y: point.y * image.naturalHeight / height,
      })),
    };
  } finally {
    source.delete();
  }
}

function enhance(cv, input, mode, settings) {
  const resources = [];
  let retained = null;
  const makeMat = () => {
    const mat = new cv.Mat();
    resources.push(mat);
    return mat;
  };
  try {
    if (mode === 'original') return input;
    if (mode === 'smart') return smartClean(cv, input, settings);

    const exposure = Number(settings.exposure || 0);
    if (mode === 'bw') {
      const gray = makeMat();
      const cleanGray = makeMat();
      const binary = makeMat();
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      cv.medianBlur(gray, cleanGray, 3);
      const smallestSide = Math.min(input.cols, input.rows);
      let blockSize = Math.max(25, Math.min(61, Math.round(smallestSide * 0.027)));
      if (blockSize % 2 === 0) blockSize += 1;
      const bias = Number(settings.cleanup ?? 56);
      const c = 4 + (bias / 100) * 10;
      cv.adaptiveThreshold(cleanGray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, blockSize, c);
      if (exposure !== 0) cv.addWeighted(binary, 1, binary, 0, exposure * 0.65, binary);
      const rgba = makeMat();
      cv.cvtColor(binary, rgba, cv.COLOR_GRAY2RGBA);
      retained = rgba;
      return rgba;
    }

    if (mode === 'gray') {
      const gray = makeMat();
      const leveled = makeMat();
      cv.cvtColor(input, gray, cv.COLOR_RGBA2GRAY);
      const clahe = new cv.CLAHE(1.75, new cv.Size(8, 8));
      try {
        clahe.apply(gray, leveled);
      } finally {
        clahe.delete();
      }
      if (exposure !== 0) cv.addWeighted(leveled, 1.04, leveled, 0, exposure, leveled);
      const rgba = makeMat();
      cv.cvtColor(leveled, rgba, cv.COLOR_GRAY2RGBA);
      retained = rgba;
      return rgba;
    }

    const rgb = makeMat();
    const lab = makeMat();
    const channels = new cv.MatVector();
    resources.push(channels);
    cv.cvtColor(input, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, channels);
    const lightness = channels.get(0);
    resources.push(lightness);
    const equalized = makeMat();
    const clahe = new cv.CLAHE(1.55, new cv.Size(8, 8));
    try {
      clahe.apply(lightness, equalized);
    } finally {
      clahe.delete();
    }
    channels.set(0, equalized);
    cv.merge(channels, lab);
    const enhancedRgb = makeMat();
    cv.cvtColor(lab, enhancedRgb, cv.COLOR_Lab2RGB);
    const color = makeMat();
    cv.cvtColor(enhancedRgb, color, cv.COLOR_RGB2RGBA);
    if (exposure !== 0) cv.addWeighted(color, 1.04, color, 0, exposure, color);
    const soft = makeMat();
    cv.GaussianBlur(color, soft, new cv.Size(0, 0), 1.15);
    const sharpened = makeMat();
    cv.addWeighted(color, 1.16, soft, -0.16, 0, sharpened);
    retained = sharpened;
    return sharpened;
  } finally {
    resources.forEach((resource) => { if (resource !== retained) resource.delete(); });
  }
}

/** Rectify the selected four corners, then apply the chosen paper treatment. */
export function processScan(image, corners, options, cv) {
  if (!isValidQuad(corners)) throw new Error('Select four distinct corners around the document without crossing the edges.');
  const { canvas: sourceCanvas, width: sourceWidth, height: sourceHeight, scale } = fitCanvas(image, options.maxEdge || 1800);
  const source = cv.imread(sourceCanvas);
  const resources = [source];
  const makeMat = () => {
    const mat = new cv.Mat();
    resources.push(mat);
    return mat;
  };

  try {
    const points = corners.map((point) => ({
      x: Math.max(0, Math.min(sourceWidth - 1, point.x * scale)),
      y: Math.max(0, Math.min(sourceHeight - 1, point.y * scale)),
    }));
    const distance = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    let outputWidth = Math.round(Math.max(distance(points[0], points[1]), distance(points[3], points[2])));
    let outputHeight = Math.round(Math.max(distance(points[0], points[3]), distance(points[1], points[2])));
    outputWidth = Math.max(160, outputWidth);
    outputHeight = Math.max(160, outputHeight);
    const outputScale = Math.min(1, (options.maxEdge || 1800) / Math.max(outputWidth, outputHeight));
    outputWidth = Math.max(1, Math.round(outputWidth * outputScale));
    outputHeight = Math.max(1, Math.round(outputHeight * outputScale));

    const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap((point) => [point.x, point.y]));
    resources.push(sourcePoints);
    const targetPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1]);
    resources.push(targetPoints);
    const transform = cv.getPerspectiveTransform(sourcePoints, targetPoints);
    resources.push(transform);
    const warped = makeMat();
    cv.warpPerspective(source, warped, transform, new cv.Size(outputWidth, outputHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE);

    let straightened = warped;
    if (options.settings?.straighten !== false) {
      const maps = computeStraightenMaps(cv, warped);
      if (maps) {
        resources.push(maps.mapX, maps.mapY);
        straightened = makeMat();
        cv.remap(warped, straightened, maps.mapX, maps.mapY, cv.INTER_LINEAR, cv.BORDER_REPLICATE);
      }
    }

    let processed = enhance(cv, straightened, options.mode || 'smart', options.settings || {});
    const ownsProcessed = processed !== straightened;
    if (ownsProcessed) resources.push(processed);
    if (options.rotation) {
      const rotated = makeMat();
      const rotation = ((options.rotation % 360) + 360) % 360;
      if (rotation === 90) cv.rotate(processed, rotated, cv.ROTATE_90_CLOCKWISE);
      else if (rotation === 180) cv.rotate(processed, rotated, cv.ROTATE_180);
      else if (rotation === 270) cv.rotate(processed, rotated, cv.ROTATE_90_COUNTERCLOCKWISE);
      else cv.rotate(processed, rotated, cv.ROTATE_90_CLOCKWISE);
      processed = rotated;
    }

    const outputCanvas = document.createElement('canvas');
    cv.imshow(outputCanvas, processed);
    return { canvas: outputCanvas, width: outputCanvas.width, height: outputCanvas.height };
  } finally {
    resources.forEach((resource) => {
      if (resource && typeof resource.delete === 'function') resource.delete();
    });
  }
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Your browser could not create the processed image.'));
    }, type, quality);
  });
}
