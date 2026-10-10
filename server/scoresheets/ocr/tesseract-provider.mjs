import Tesseract from "tesseract.js";

export function createTesseractScoresheetOcrProvider() {
  let worker = null;
  return {
    id: "tesseract",
    version: "tesseract.js-v1",
    async isAvailable() {
      try {
        const probe = await Tesseract.createWorker("eng", 1, { logger: () => {} });
        await probe.terminate();
        return true;
      } catch {
        return false;
      }
    },
    async recognize(processed) {
      if (!worker) {
        worker = await Tesseract.createWorker("eng+spa+deu", 1, { logger: () => {} });
      }
      const pages = [];
      for (const page of processed.pages) {
        const result = await worker.recognize(page.buffer);
        const width = page.width;
        const height = page.height;
        const tokens = (result.data.words ?? []).map((word, index) => ({
          id: `w-${page.page}-${index}`,
          page: page.page,
          text: word.text,
          confidence: word.confidence / 100,
          boundingBox: word.bbox
            ? { x: word.bbox.x0, y: word.bbox.y0, width: word.bbox.x1 - word.bbox.x0, height: word.bbox.y1 - word.bbox.y0 }
            : null,
          lineId: `line-${page.page}-${word.line_num ?? index}`,
        }));
        pages.push({
          page: page.page,
          width,
          height,
          tokens,
          rawText: result.data.text ?? "",
        });
      }
      return {
        providerId: "tesseract",
        providerVersion: "tesseract.js-v1",
        pages,
      };
    },
    async dispose() {
      if (worker) {
        await worker.terminate();
        worker = null;
      }
    },
  };
}
