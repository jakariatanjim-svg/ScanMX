/** A crop must be a finite, convex, clockwise quadrilateral in image coordinates. */
export function isValidQuad(points) {
  if (!Array.isArray(points) || points.length !== 4 ||
      points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  return points.every((point, index) => {
    const next = points[(index + 1) % 4];
    const after = points[(index + 2) % 4];
    const cross = (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
    return cross > 1 && Math.hypot(next.x - point.x, next.y - point.y) >= 2;
  });
}
