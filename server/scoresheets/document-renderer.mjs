import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { MAX_PAGES } from "../../shared/scoresheet/constants.mjs";

/** @typedef {{ mimeType: string; pageCount: number; encrypted: boolean; corrupt: boolean }} DocumentInfo */
/** @typedef {{ page: number; width: number; height: number; buffer: Buffer }} RenderedPage */

/**
 * @returns {import("../../shared/scoresheet/types.mjs").ScoresheetDocumentRenderer | {
 *   supports(mimeType: string): boolean;
 *   inspect(buffer: Buffer, mimeType: string): Promise<DocumentInfo>;
 *   renderPages(buffer: Buffer, mimeType: string, options?: { density?: number; maxPages?: number }): Promise<RenderedPage[]>;
 * }}
 */
export function createSharpDocumentRenderer() {
  return {
    supports(mimeType) {
      return mimeType === "application/pdf" || String(mimeType ?? "").startsWith("image/");
    },
    async inspect(buffer, mimeType) {
      if (!buffer?.length) throw new Error("SCORESHEET_FILE_CORRUPT");
      if (mimeType === "application/pdf") return inspectPdfBuffer(buffer);
      try {
        const meta = await sharp(buffer, { failOn: "error" }).metadata();
        return {
          mimeType,
          pageCount: 1,
          encrypted: false,
          corrupt: !meta.width,
        };
      } catch {
        throw new Error("SCORESHEET_FILE_CORRUPT");
      }
    },
    async renderPages(buffer, mimeType, { density = 200, maxPages = MAX_PAGES } = {}) {
      if (mimeType === "application/pdf") {
        const info = await inspectPdfBuffer(buffer);
        if (info.encrypted) throw new Error("SCORESHEET_PDF_ENCRYPTED");
        return renderPdfWithGhostscript(buffer, { density, maxPages: info.pageCount || maxPages });
      }
      const rendered = await sharp(buffer, { failOn: "error" }).png().toBuffer({ resolveWithObject: true });
      return [{
        page: 1,
        width: rendered.info.width,
        height: rendered.info.height,
        buffer: rendered.data,
      }];
    },
  };
}

async function inspectPdfBuffer(buffer) {
  if (!buffer.slice(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error("SCORESHEET_FILE_CORRUPT");
  }
  const body = buffer.toString("latin1");
  if (/\/Encrypt/i.test(body)) {
    return { mimeType: "application/pdf", pageCount: 0, encrypted: true, corrupt: false };
  }
  if (ghostscriptReportsEncryption(buffer)) {
    return { mimeType: "application/pdf", pageCount: 0, encrypted: true, corrupt: false };
  }
  try {
    const data = new Uint8Array(buffer);
    const pdf = await getDocument({ data, password: "" }).promise;
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    return { mimeType: "application/pdf", pageCount, encrypted: false, corrupt: false };
  } catch {
    throw new Error("SCORESHEET_FILE_CORRUPT");
  }
}

function ghostscriptAvailable() {
  const probe = spawnSync("gs", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

async function withTempPdf(buffer, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "mm-pdf-"));
  const input = path.join(dir, "doc.pdf");
  writeFileSync(input, buffer);
  try {
    return await fn(input, dir);
  } finally {
    try {
      unlinkSync(input);
    } catch {
      /* ignore */
    }
  }
}

function ghostscriptReportsEncryption(buffer) {
  if (!ghostscriptAvailable()) return false;
  const dir = mkdtempSync(path.join(tmpdir(), "mm-pdf-"));
  const input = path.join(dir, "doc.pdf");
  writeFileSync(input, buffer);
  try {
    const out = path.join(dir, "probe.png");
    const result = spawnSync("gs", [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-sPDFPassword=",
      "-dFirstPage=1",
      "-dLastPage=1",
      "-sDEVICE=pngalpha",
      "-r36",
      `-sOutputFile=${out}`,
      input,
    ], { encoding: "utf8" });
    try {
      unlinkSync(out);
    } catch {
      /* ignore */
    }
    const stderr = `${result.stderr ?? ""}${result.stdout ?? ""}`;
    return /Password did not work|Cannot decrypt/i.test(stderr);
  } finally {
    try {
      unlinkSync(input);
    } catch {
      /* ignore */
    }
  }
}

async function renderPdfWithGhostscript(buffer, { density, maxPages }) {
  if (!ghostscriptAvailable()) {
    throw new Error("SCORESHEET_FILE_CORRUPT");
  }
  return withTempPdf(buffer, async (input, dir) => {
    const pattern = path.join(dir, "page-%d.png");
    const result = spawnSync("gs", [
      "-q",
      "-dNOPAUSE",
      "-dBATCH",
      "-sDEVICE=pngalpha",
      `-r${density}`,
      "-dTextAlphaBits=4",
      "-dGraphicsAlphaBits=4",
      `-dFirstPage=1`,
      `-dLastPage=${maxPages}`,
      `-sOutputFile=${pattern}`,
      input,
    ], { encoding: "utf8" });
    if (result.status !== 0) {
      const stderr = `${result.stderr ?? ""}${result.stdout ?? ""}`;
      if (/Password did not work|Cannot decrypt/i.test(stderr)) {
        throw new Error("SCORESHEET_PDF_ENCRYPTED");
      }
      throw new Error("SCORESHEET_FILE_CORRUPT");
    }
    const pages = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const file = path.join(dir, `page-${page}.png`);
      let png;
      try {
        png = readFileSync(file);
      } catch {
        break;
      }
      const meta = await sharp(png).metadata();
      pages.push({
        page,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        buffer: png,
      });
      try {
        unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
    if (!pages.length) throw new Error("SCORESHEET_FILE_CORRUPT");
    return pages;
  });
}

export async function inspectDocument(buffer, mimeType) {
  const renderer = createSharpDocumentRenderer();
  return renderer.inspect(buffer, mimeType);
}
