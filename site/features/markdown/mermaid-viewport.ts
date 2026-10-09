export const MIN_DIAGRAM_ZOOM = 0.01;
export const DIAGRAM_PADDING = 24;

export function clampDiagramZoom(value: number) {
  return Math.min(3, Math.max(MIN_DIAGRAM_ZOOM, value));
}

export function fitDiagramZoom(width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return clampDiagramZoom(Math.min(1, Math.max(1, viewportWidth - 2 * DIAGRAM_PADDING) / width, Math.max(1, viewportHeight - 2 * DIAGRAM_PADDING) / height));
}

// Account for centered whitespace as well as scale when preserving the focal point.
export function diagramZoomScroll(size: number, viewport: number, scroll: number, anchor: number, previous: number, next: number) {
  const before = Math.max(DIAGRAM_PADDING, (viewport - size * previous) / 2);
  const after = Math.max(DIAGRAM_PADDING, (viewport - size * next) / 2);
  return Math.max(0, (scroll + anchor - before) * next / previous + after - anchor);
}
