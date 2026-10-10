import path from "node:path";
import sharp from "sharp";
import { MAX_DECODED_PIXELS, MAX_PAGES } from "../../shared/scoresheet/constants.mjs";
import { pixelCrop, validateNormalizedRegion } from "../../shared/scoresheet/regions.mjs";
import { clampDeskewAngle, normalizeDeskewSettings } from "../../shared/scoresheet/deskew.mjs";
import { createSharpDocumentRenderer } from "./document-renderer.mjs";

const TRANSFORM_ORDER = ["exif", "rotation90", "deskew", "crop", "contrast", "grayscale"];

export { TRANSFORM_ORDER };

export async function decodeUploadToPages({ buffer, mimeType, draftId, store, preprocessing = {} }) {
  const renderer = createSharpDocumentRenderer();
  const rendered = await renderer.renderPages(buffer, mimeType, { maxPages: MAX_PAGES });
  const pages = [];
  for (const source of rendered) {
    const pageNumber = source.page;
    const page = await preprocessPipeline(sharp(source.buffer), preprocessing, {
      width: source.width,
      height: source.height,
    });
    const rel = path.join("processed", `${draftId}-p${pageNumber}.jpg`);
    const abs = store.resolveStoragePath(rel);
    await page.image.jpeg({ quality: 88, mozjpeg: true }).toFile(abs);
    const thumbRel = path.join("processed", "thumbs", `${draftId}-p${pageNumber}.jpg`);
    const thumbAbs = store.resolveStoragePath(thumbRel);
    await page.image.clone().resize({ width: 480 }).jpeg({ quality: 80 }).toFile(thumbAbs);
    pages.push({
      page: pageNumber,
      width: page.width,
      height: page.height,
      path: rel,
      thumbPath: thumbRel,
    });
  }
  return pages;
}

export async function preprocessPipeline(input, preprocessing = {}, sourceSize = {}) {
  let image = input.rotate();
  const metaAfterExif = await image.metadata();

  if (preprocessing.rotation) {
    image = image.rotate(preprocessing.rotation);
  }

  const deskew = normalizeDeskewSettings(preprocessing.deskew ?? {});
  let appliedDeskew = 0;
  if (deskew.mode === "manual") {
    appliedDeskew = clampDeskewAngle(deskew.appliedAngle);
    image = image.rotate(appliedDeskew, { background: "#ffffff" });
  } else if (deskew.mode === "automatic") {
    appliedDeskew = await detectSkewAngle(image);
    image = image.rotate(appliedDeskew, { background: "#ffffff" });
  }

  let width = metaAfterExif.width ?? sourceSize.width ?? 0;
  let height = metaAfterExif.height ?? sourceSize.height ?? 0;
  const afterRotate = await image.metadata();
  width = afterRotate.width ?? width;
  height = afterRotate.height ?? height;

  if (preprocessing.crop) {
    const crop = pixelCrop(validateNormalizedRegion(preprocessing.crop), width, height);
    if (crop) {
      image = image.extract(crop);
      preprocessing.cropped = true;
      width = crop.width;
      height = crop.height;
    }
  }

  if ((width ?? 0) * (height ?? 0) > MAX_DECODED_PIXELS) {
    const scale = Math.sqrt(MAX_DECODED_PIXELS / ((width ?? 1) * (height ?? 0)));
    image = image.resize({ width: Math.floor((width ?? 1) * scale) });
  }

  if (preprocessing.contrastAdjusted) image = image.normalize();
  if (preprocessing.grayscale !== false) image = image.grayscale();

  const processed = await image.toBuffer({ resolveWithObject: true });
  return {
    image: sharp(processed.data),
    width: processed.info.width,
    height: processed.info.height,
    deskewApplied: appliedDeskew,
  };
}

async function detectSkewAngle(image) {
  const { data, info } = await image.clone().greyscale().raw().toBuffer({ resolveWithObject: true });
  const candidates = [-2, -1, 0, 1, 2];
  let best = { angle: 0, score: -1 };
  for (const angle of candidates) {
    const score = projectionScore(data, info.width, info.height, angle);
    if (score > best.score) best = { angle, score };
  }
  return clampDeskewAngle(best.angle);
}

function projectionScore(data, width, height, angle) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let score = 0;
  for (let y = 0; y < height; y += 4) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 4) {
      const rx = Math.round(x * cos - y * sin);
      const ry = Math.round(x * sin + y * cos);
      if (rx < 0 || ry < 0 || rx >= width || ry >= height) continue;
      rowSum += data[ry * width + rx] < 200 ? 1 : 0;
    }
    score += rowSum * rowSum;
  }
  return score;
}

export async function readProcessedPage(store, rel) {
  const abs = store.resolveStoragePath(rel);
  return sharp(abs).toBuffer();
}
