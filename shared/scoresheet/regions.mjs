export function validateNormalizedRegion(region, { minSize = 0.05 } = {}) {
  if (!region) return null;
  const { x, y, width, height } = region;
  for (const value of [x, y, width, height]) {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error("scoresheet_invalid_region");
  }
  if (width <= 0 || height <= 0) throw new Error("scoresheet_invalid_region");
  if (width < minSize || height < minSize) throw new Error("scoresheet_invalid_region");
  if (x < 0 || y < 0 || x + width > 1.001 || y + height > 1.001) throw new Error("scoresheet_invalid_region");
  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function tokenInRegion(token, region, pageSize) {
  if (!region || !token?.boundingBox) return true;
  const { width: pageW, height: pageH } = pageSize;
  const box = token.boundingBox;
  const cx = (box.x + box.width / 2) / pageW;
  const cy = (box.y + box.height / 2) / pageH;
  return cx >= region.x && cx <= region.x + region.width && cy >= region.y && cy <= region.y + region.height;
}

export function pixelCrop(region, width, height) {
  const valid = validateNormalizedRegion(region);
  if (!valid) return null;
  return {
    left: Math.floor(valid.x * width),
    top: Math.floor(valid.y * height),
    width: Math.max(1, Math.floor(valid.width * width)),
    height: Math.max(1, Math.floor(valid.height * height)),
  };
}
