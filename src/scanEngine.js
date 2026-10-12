import cvModule from '@techstark/opencv-js';

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
      for (const epsilon of [0.012, 0.018, 0.025, 0.035, 0.05]) {
        const approximation = new cv.Mat();
        cv.approxPolyDP(contour, approximation, epsilon * perimeter, true);
        if (approximation.rows === 4 && cv.isContourConvex(approximation)) {
          const raw = [];
          for (let point = 0; point < 4; point += 1) {
            raw.push({ x: approximation.data32S[point * 2], y: approximation.data32S[point * 2 + 1] });
          }
          const points = orderCorners(raw);
          const quadArea = polygonArea(points);
          const ratio = quadArea / area;
          if (ratio > 0.68 && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
            candidates.push({ points, area: quadArea, ratio });
          }
        }
        approximation.delete();
      }
      contour.delete();
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return candidates;
}

/** Find the largest convincing four-sided page outline; fall back to the full photo when uncertain. */
export function detectPage(image, cv) {
  const { canvas, width, height } = fitCanvas(image, 900);
  const totalArea = width * height;
  const minimumArea = totalArea * 0.12;
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const allCandidates = [];
  try {
    const source = cv.imread(canvas);
    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blurred, edges, 35, 115);
      cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1);
      allCandidates.push(...contourCandidates(cv, edges, minimumArea));

      if (!allCandidates.length) {
        const binary = new cv.Mat();
        const closed = new cv.Mat();
        const thresholdKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
        try {
          cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
          cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, thresholdKernel);
          allCandidates.push(...contourCandidates(cv, closed, minimumArea));
          if (!allCandidates.length) {
            cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
            cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, thresholdKernel);
            allCandidates.push(...contourCandidates(cv, closed, minimumArea));
          }
        } finally {
          binary.delete();
          closed.delete();
          thresholdKernel.delete();
        }
      }
      source.delete();
    } catch (error) {
      source.delete();
      throw error;
    }

    const usable = allCandidates
      .filter((candidate) => candidate.area < totalArea * 0.985)
      .sort((first, second) => second.area - first.area);
    const best = usable[0];
    const scaleX = image.naturalWidth / width;
    const scaleY = image.naturalHeight / height;
    if (best) {
      return {
        corners: best.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY })),
        detected: true,
        confidence: Math.min(1, best.area / totalArea),
      };
    }
    return {
      corners: [
        { x: 0, y: 0 },
        { x: image.naturalWidth, y: 0 },
        { x: image.naturalWidth, y: image.naturalHeight },
        { x: 0, y: image.naturalHeight },
      ],
      detected: false,
      confidence: 0,
    };
  } finally {
    gray.delete();
    blurred.delete();
    edges.delete();
    kernel.delete();
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
    let detailSource = lightness;
    if (mode === 'smart') {
      const background = makeMat();
      const normalized = makeMat();
      let blurSize = Math.max(21, Math.min(61, Math.round(Math.min(input.cols, input.rows) * 0.04)));
      if (blurSize % 2 === 0) blurSize += 1;
      cv.GaussianBlur(lightness, background, new cv.Size(blurSize, blurSize), 0, 0, cv.BORDER_REPLICATE);
      cv.divide(lightness, background, normalized, 255);
      detailSource = normalized;
    }
    const equalized = makeMat();
    const clahe = new cv.CLAHE(mode === 'smart' ? 1.65 : 1.55, new cv.Size(8, 8));
    try {
      clahe.apply(detailSource, equalized);
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
    const targetPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outputWidth - 1, 0, outputWidth - 1, outputHeight - 1, 0, outputHeight - 1]);
    const transform = cv.getPerspectiveTransform(sourcePoints, targetPoints);
    const warped = makeMat();
    cv.warpPerspective(source, warped, transform, new cv.Size(outputWidth, outputHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    resources.push(sourcePoints, targetPoints, transform);

    let processed = enhance(cv, warped, options.mode || 'smart', options.settings || {});
    const ownsProcessed = processed !== warped;
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
