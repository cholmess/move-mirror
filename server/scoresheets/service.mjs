import { Chess } from "chess.js";
import { assertReadyForImport, draftReviewState } from "../../shared/scoresheet/review.mjs";
import { DEFAULT_DECODER_CONFIG } from "../../shared/scoresheet/constants.mjs";
import { extractMetadataHints, observationToRawMoveTokens } from "../../shared/scoresheet/layout.mjs";
import {
  applyManualPlySelection,
  decodeScoresheetSequence,
  recomputeFromPly,
} from "../../shared/scoresheet/legality-decoder.mjs";
import { buildPgnFromTranscription, parsedFromTranscription } from "../../shared/scoresheet/pgn.mjs";
import { validateNormalizedRegion } from "../../shared/scoresheet/regions.mjs";
import { validateUpload } from "./mime.mjs";
import { decodeUploadToPages, readProcessedPage } from "./preprocess.mjs";
import { resolveScoresheetOcrProvider } from "./ocr/index.mjs";
import { inspectDocument } from "./document-renderer.mjs";
import { ScoresheetOcrQueue } from "./ocr-queue.mjs";

const ocrQueue = new ScoresheetOcrQueue();
const activeRecognize = new Map();

export function createScoresheetService({ scoresheetStore, gamesStore }) {
  function publicDraft(draft) {
    const { source, fixtureId: _fixtureId, ...rest } = draft;
    const review = draftReviewState(draft.transcription?.plies ?? [], draft.transcription?.startingFen);
    return {
      ...rest,
      review,
      source: {
        originalFilename: source.originalFilename,
        mimeType: source.mimeType,
        byteSize: source.byteSize,
        pageCount: source.pageCount,
        sha256: source.sha256,
        originalAvailable: Boolean(source.originalPath),
        processedPageCount: source.processedPagePaths?.length ?? 0,
        keepOriginal: source.keepOriginal !== false,
      },
    };
  }

  async function createFromUpload(input) {
    const buffer = Buffer.from(input.bytes, "base64");
    const mimeType = validateUpload({
      filename: input.filename,
      mimeType: input.mimeType,
      byteSize: buffer.length,
      buffer,
    });
    const inspected = await inspectDocument(buffer, mimeType);
    if (inspected.encrypted) throw new Error("SCORESHEET_PDF_ENCRYPTED");
    if (inspected.corrupt) throw new Error("SCORESHEET_FILE_CORRUPT");
    const draft = scoresheetStore.createDraft({
      filename: input.filename,
      mimeType,
      buffer,
      locale: input.locale ?? "es",
      keepOriginal: input.keepOriginal !== false,
      fixtureId: input.fixtureId ?? null,
      pageCount: inspected.pageCount || 1,
    });
    return publicDraft(draft);
  }

  async function preprocessDraft(id, patch = {}) {
    const draft = scoresheetStore.readDraft(id);
    draft.status = "preprocessing";
    draft.preprocessing = { ...draft.preprocessing, ...patch.preprocessing, version: draft.preprocessing.version };
    draft.locale = patch.locale ?? draft.locale;
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);

    const originalAbs = scoresheetStore.resolveStoragePath(draft.source.originalPath);
    const { readFileSync } = await import("node:fs");
    const buffer = readFileSync(originalAbs);
    const pages = await decodeUploadToPages({
      buffer,
      mimeType: draft.source.mimeType,
      draftId: draft.id,
      store: scoresheetStore,
      preprocessing: draft.preprocessing,
    });
    draft.source.processedPagePaths = pages.map((p) => p.path);
    draft.source.pageCount = pages.length;
    draft.status = "uploaded";
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);
    return publicDraft(draft);
  }

  async function recognizeDraft(id, { signal } = {}) {
    return ocrQueue.enqueue(async () => {
      const draft = scoresheetStore.readDraft(id);
      draft.status = "reading";
      draft.ocrJob = { status: "running", startedAt: new Date().toISOString() };
      draft.updatedAt = new Date().toISOString();
      scoresheetStore.writeDraft(draft);

      const controller = new AbortController();
      activeRecognize.set(id, controller);
      if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

      try {
        const provider = await resolveScoresheetOcrProvider();
        const pages = [];
        for (const rel of draft.source.processedPagePaths) {
          const buffer = await readProcessedPage(scoresheetStore, rel);
          const meta = await import("sharp").then(({ default: sharp }) => sharp(buffer).metadata());
          pages.push({ page: pages.length + 1, buffer, width: meta.width ?? 0, height: meta.height ?? 0, path: rel });
        }
        const observation = await provider.recognize({
          draftId: draft.id,
          fixtureKey: draft.source.sha256,
          originalFilename: draft.source.originalFilename,
          fixtureId: draft.fixtureId ?? null,
          pages,
        });
        const rel = scoresheetStore.saveObservation(draft.id, observation);
        draft.ocr = {
          providerId: observation.providerId ?? provider.id,
          providerVersion: observation.providerVersion ?? provider.version,
          completedAt: new Date().toISOString(),
          rawObservationPath: rel,
        };
        const moveRows = observationToRawMoveTokens(observation, {
          movesRegion: draft.preprocessing?.movesRegion ?? null,
        });
        const decoded = decodeScoresheetSequence({
          startingFen: draft.transcription.startingFen,
          moveRows,
          locale: draft.locale,
          config: DEFAULT_DECODER_CONFIG,
        });
        draft.transcription.plies = decoded.plies;
        draft.transcription.metadata = {
          ...draft.transcription.metadata,
          ...extractMetadataHints(observation.pages?.map((p) => p.rawText).join("\n")),
        };
        const review = draftReviewState(draft.transcription.plies, draft.transcription.startingFen);
        draft.status = review.readyToConfirm ? "ready_to_confirm" : "review_required";
        draft.ocrJob = { status: "completed", completedAt: new Date().toISOString() };
        draft.updatedAt = new Date().toISOString();
        scoresheetStore.writeDraft(draft);
        return publicDraft(draft);
      } finally {
        activeRecognize.delete(id);
      }
    }, { signal });
  }

  function cancelRecognize(id) {
    activeRecognize.get(id)?.abort();
    const draft = scoresheetStore.readDraft(id);
    draft.status = "uploaded";
    draft.ocrJob = { status: "cancelled", completedAt: new Date().toISOString() };
    scoresheetStore.writeDraft(draft);
    return publicDraft(draft);
  }

  function patchDraft(id, patch) {
    const draft = scoresheetStore.readDraft(id);
    if (patch.locale) draft.locale = patch.locale;
    if (patch.transcription) draft.transcription = { ...draft.transcription, ...patch.transcription };
    if (patch.preprocessing) {
      if (patch.preprocessing.crop) validateNormalizedRegion(patch.preprocessing.crop);
      if (patch.preprocessing.movesRegion) validateNormalizedRegion(patch.preprocessing.movesRegion);
      draft.preprocessing = { ...draft.preprocessing, ...patch.preprocessing };
    }
    const review = draftReviewState(draft.transcription.plies ?? [], draft.transcription.startingFen);
    if (!draft.transcription.confirmedByUser) {
      draft.status = review.readyToConfirm ? "ready_to_confirm" : "review_required";
    }
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);
    return publicDraft(draft);
  }

  async function resolveDraft(id, input) {
    const draft = scoresheetStore.readDraft(id);
    let plies = draft.transcription.plies ?? [];
    if (typeof input.plyIndex === "number") {
      if (input.uci && input.san) {
        plies = applyManualPlySelection(plies, input.plyIndex, {
          uci: input.uci,
          san: input.san,
          locale: draft.locale,
        });
      }
      if (input.confirmPly === true) {
        plies = plies.map((ply, index) => (index === input.plyIndex
          ? { ...ply, confirmedByUser: true, userConfirmedMove: true }
          : ply));
      }
      if (input.recomputeFromPlyIndex != null) {
        const { readFileSync } = await import("node:fs");
        const obsPath = scoresheetStore.resolveStoragePath(draft.ocr.rawObservationPath);
        const observation = JSON.parse(readFileSync(obsPath, "utf8"));
        const moveRows = observationToRawMoveTokens(observation, {
          movesRegion: draft.preprocessing?.movesRegion ?? null,
        });
        plies = recomputeFromPly({
          startingFen: draft.transcription.startingFen,
          plies,
          fromPlyIndex: input.recomputeFromPlyIndex,
          moveRows,
          locale: draft.locale,
        });
      }
    }
    draft.transcription.plies = plies;
    const review = draftReviewState(plies, draft.transcription.startingFen);
    draft.status = review.readyToConfirm ? "ready_to_confirm" : "review_required";
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);
    return publicDraft(draft);
  }

  function confirmDraft(id, input) {
    const draft = scoresheetStore.readDraft(id);
    assertReadyForImport(draft.transcription.plies ?? [], draft.transcription.startingFen);
    if (!input?.confirmed) throw new Error("scoresheet_confirmation_required");
    draft.transcription.confirmedByUser = true;
    draft.transcription.confirmedAt = new Date().toISOString();
    draft.status = "confirmed";
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);
    return publicDraft(draft);
  }

  async function importDraft(id, input) {
    const draft = scoresheetStore.readDraft(id);
    if (!draft.transcription.confirmedByUser && draft.status !== "confirmed") {
      throw new Error("scoresheet_confirmation_required");
    }
    assertReadyForImport(draft.transcription.plies ?? [], draft.transcription.startingFen);

    const plies = draft.transcription.plies ?? [];
    const parsed = parsedFromTranscription({
      startingFen: draft.transcription.startingFen,
      plies,
      result: draft.transcription.result ?? input.result ?? "*",
    });
    const metadata = draft.transcription.metadata ?? {};
    const pgn = buildPgnFromTranscription({
      startingFen: draft.transcription.startingFen,
      plies,
      metadata,
      result: draft.transcription.result ?? input.result ?? "*",
    });

    const job = gamesStore.createJob("scoresheet", { draftId: draft.id });
    gamesStore.updateJob(job.id, { status: "running", startedAt: new Date().toISOString() });
    const result = gamesStore.importParsed({
      parsed,
      raw: pgn,
      sourceType: "scoresheet",
      importJobId: job.id,
      externalId: draft.source.sha256,
      parsedMetadata: metadata,
      overrides: {
        ...metadata,
        playerColor: input.playerColor,
        whiteName: metadata.whiteName,
        blackName: metadata.blackName,
        sourceType: "scoresheet",
        confirmedFields: ["players.playerResolution", "transcription"],
      },
    });

    gamesStore.updateJob(job.id, {
      status: result.game.players.playerResolution.confidence === "verified" ? "completed" : "awaiting_review",
      completedAt: new Date().toISOString(),
      checkpoint: { importedGameIds: [result.game.id] },
      summary: {
        discovered: 1,
        parsed: 1,
        newCanonicalGames: result.disposition === "new_canonical_game" ? 1 : 0,
        mergedDuplicates: result.disposition === "merged_with_existing" ? 1 : 0,
        exactDuplicates: result.disposition === "exact_duplicate" ? 1 : 0,
        requiresReview: result.game.players.playerResolution.confidence === "verified" ? 0 : 1,
        excluded: 0,
        failed: 0,
      },
    });

    draft.status = "imported";
    draft.import = {
      importJobId: job.id,
      canonicalGameId: result.game.id,
      duplicateDisposition: result.disposition,
    };
    draft.updatedAt = new Date().toISOString();
    scoresheetStore.writeDraft(draft);

    if (input.deleteOriginal) scoresheetStore.deleteOriginal(id);

    return {
      draft: publicDraft(draft),
      importJobId: job.id,
      canonicalGameId: result.game.id,
      duplicateDisposition: result.disposition,
    };
  }

  async function pagePreview(id, pageNumber) {
    const draft = scoresheetStore.readDraft(id);
    const rel = draft.source.processedPagePaths[pageNumber - 1];
    if (!rel) throw new Error("scoresheet_page_not_found");
    const buffer = await readProcessedPage(scoresheetStore, rel);
    return { mimeType: "image/jpeg", bytes: buffer.toString("base64") };
  }

  return {
    publicDraft,
    createFromUpload,
    preprocessDraft,
    recognizeDraft,
    cancelRecognize,
    patchDraft,
    resolveDraft,
    confirmDraft,
    importDraft,
    pagePreview,
    ocrQueue,
  };
}

export function validateConfirmedSequence(plies, startingFen) {
  const chess = new Chess(startingFen);
  for (const ply of plies) {
    if (!ply.selectedUci) return false;
    const ok = chess.move({
      from: ply.selectedUci.slice(0, 2),
      to: ply.selectedUci.slice(2, 4),
      promotion: ply.selectedUci[4],
    });
    if (!ok) return false;
  }
  return true;
}
