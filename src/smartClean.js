/**
 * Estimate the paper illumination separately from its ink, then normalize each
 * color channel. Closing fills thin text strokes instead of blurring ink into
 * the illumination map (which creates gray halos around text).
 *
 * The estimate is bounded to 900px for predictable memory and mobile CPU use.
 * This is shadow/white-balance correction, not reconstruction of missing text
 * or geometric dewarping of curved pages.
 */
export function smartClean(cv, input, settings = {}) {
  const resources = [];
  const mat = () => {
    const value = new cv.Mat();
    resources.push(value);
    return value;
  };
  let result;
  try {
    const rgb = mat();
    cv.cvtColor(input, rgb, cv.COLOR_RGBA2RGB);
    const reduced = mat();
    const scale = Math.min(1, 900 / Math.max(input.cols, input.rows));
    cv.resize(rgb, reduced, new cv.Size(Math.max(1, Math.round(input.cols * scale)), Math.max(1, Math.round(input.rows * scale))), 0, 0, cv.INTER_AREA);

    // Fill characters, but retain the wider brightness changes of fold shadows.
    let kernelSize = Math.max(3, Math.min(15, Math.round(Math.min(reduced.cols, reduced.rows) * 0.018)));
    if (kernelSize % 2 === 0) kernelSize++;
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize));
    resources.push(kernel);
    const closed = mat();
    const backgroundSmall = mat();
    cv.morphologyEx(reduced, closed, cv.MORPH_CLOSE, kernel);
    cv.GaussianBlur(closed, backgroundSmall, new cv.Size(0, 0), Math.max(1, kernelSize / 4), 0, cv.BORDER_REPLICATE);
    const background = mat();
    cv.resize(backgroundSmall, background, new cv.Size(input.cols, input.rows), 0, 0, cv.INTER_LINEAR);

    const cleanup = Number(settings.cleanup ?? 80);
    const strength = Math.max(0, Math.min(100, Number.isFinite(cleanup) ? cleanup : 80)) / 100;
    const exposure = Math.max(-30, Math.min(30, Number(settings.exposure) || 0));
    const output = mat();
    input.copyTo(output);
    const src = input.data;
    const paper = background.data;
    const dest = output.data;
    for (let pixel = 0, bg = 0; pixel < src.length; pixel += 4, bg += 3) {
      for (let channel = 0; channel < 3; channel++) {
        // Limit gain in near-black regions: do not magnify sensor noise or
        // pretend to recover detail that the camera never captured.
        const illumination = Math.max(48, paper[bg + channel]);
        const normalized = Math.min(255, src[pixel + channel] * 250 / illumination);
        // Gentle black-point/white-point adjustment, without hard binarization.
        const toned = Math.max(0, Math.min(255, (normalized - 8) * 255 / 240));
        dest[pixel + channel] = Math.max(0, Math.min(255,
          src[pixel + channel] * (1 - strength) + toned * strength + exposure));
      }
      dest[pixel + 3] = 255;
    }

    // A restrained unsharp mask preserves fine strokes without harsh outlines.
    const soft = mat();
    const sharpened = mat();
    cv.GaussianBlur(output, soft, new cv.Size(0, 0), 0.8);
    cv.addWeighted(output, 1 + 0.12 * strength, soft, -0.12 * strength, 0, sharpened);
    result = sharpened;
    return result;
  } finally {
    resources.forEach((resource) => { if (resource !== result) resource.delete(); });
  }
}
