import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DRAFT_VERSION, PREPROCESS_VERSION } from "../../shared/scoresheet/constants.mjs";
import { assertInsideScoresheetRoot, safeDraftFilename, scoresheetRoot } from "./paths.mjs";

function atomicJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSafe(tmp, file);
}

function renameSafe(from, to) {
  renameSync(from, to);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function createScoresheetStore(gamesRoot) {
  const root = scoresheetRoot(gamesRoot);
  const dirs = {
    root,
    raw: path.join(root, "raw"),
    processed: path.join(root, "processed"),
    drafts: path.join(root, "drafts"),
    ocr: path.join(root, "ocr"),
    thumbs: path.join(root, "processed", "thumbs"),
  };

  function ensure() {
    Object.values(dirs).forEach((dir) => mkdirSync(dir, { recursive: true }));
  }

  function sha256Buffer(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
  }

  function draftPath(id) {
    return assertInsideScoresheetRoot(dirs.drafts, path.join(dirs.drafts, safeDraftFilename(id)));
  }

  function readDraft(id) {
    const file = draftPath(id);
    if (!existsSync(file)) throw new Error("scoresheet_draft_not_found");
    try {
      return readJson(file);
    } catch {
      throw new Error("scoresheet_draft_corrupt");
    }
  }

  function writeDraft(draft) {
    const file = draftPath(draft.id);
    atomicJson(file, draft);
    return draft;
  }

  function createDraft({ filename, mimeType, buffer, locale = "es", keepOriginal = true, fixtureId = null, pageCount = 1 }) {
    ensure();
    const id = randomUUID();
    const sha256 = sha256Buffer(buffer);
    const ext = path.extname(filename || "") || guessExt(mimeType);
    const originalRel = path.join("raw", `${id}${ext}`);
    const originalPath = assertInsideScoresheetRoot(root, path.join(root, originalRel));
    writeFileSync(originalPath, buffer);
    const now = new Date().toISOString();
    const draft = {
      id,
      version: DRAFT_VERSION,
      status: "uploaded",
      locale,
      fixtureId,
      source: {
        originalFilename: filename,
        mimeType,
        byteSize: buffer.length,
        pageCount: mimeType === "application/pdf" ? pageCount : 1,
        sha256,
        originalPath: keepOriginal ? originalRel : null,
        processedPagePaths: [],
        keepOriginal,
      },
      preprocessing: {
        rotation: 0,
        cropped: false,
        deskewed: false,
        contrastAdjusted: false,
        grayscale: true,
        version: PREPROCESS_VERSION,
        selectedPages: [1],
        crop: null,
        movesRegion: null,
        metadataRegion: null,
        deskew: { mode: "none", detectedAngle: null, appliedAngle: 0 },
      },
      ocr: {
        providerId: null,
        providerVersion: null,
        completedAt: null,
        rawObservationPath: null,
      },
      transcription: {
        startingFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        plies: [],
        result: null,
        metadata: {},
        confirmedAt: null,
        confirmedByUser: false,
      },
      import: {
        importJobId: null,
        canonicalGameId: null,
        duplicateDisposition: null,
      },
      createdAt: now,
      updatedAt: now,
    };
    return writeDraft(draft);
  }

  function listDrafts() {
    ensure();
    return readdirSync(dirs.drafts)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          return readJson(path.join(dirs.drafts, name));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function resolveStoragePath(relativePath) {
    if (!relativePath) return null;
    return assertInsideScoresheetRoot(root, path.join(root, relativePath));
  }

  function saveObservation(draftId, observation) {
    const rel = path.join("ocr", `${draftId}.json`);
    const abs = assertInsideScoresheetRoot(root, path.join(root, rel));
    atomicJson(abs, observation);
    return rel;
  }

  function deleteDraft(id) {
    const draft = readDraft(id);
    for (const rel of [draft.source.originalPath, ...(draft.source.processedPagePaths ?? []), draft.ocr.rawObservationPath].filter(Boolean)) {
      const abs = resolveStoragePath(rel);
      if (abs && existsSync(abs)) rmSync(abs, { force: true });
    }
    rmSync(draftPath(id), { force: true });
    return { ok: true, id };
  }

  function deleteOriginal(id) {
    const draft = readDraft(id);
    if (draft.source.originalPath) {
      const abs = resolveStoragePath(draft.source.originalPath);
      if (abs && existsSync(abs)) rmSync(abs, { force: true });
    }
    draft.source.originalPath = null;
    draft.updatedAt = new Date().toISOString();
    return writeDraft(draft);
  }

  function cleanupOrphans() {
    ensure();
    const draftIds = new Set(listDrafts().map((d) => d.id));
    let removed = 0;
    for (const dir of [dirs.raw, dirs.processed, dirs.ocr, dirs.thumbs]) {
      for (const name of readdirSync(dir)) {
        const id = name.split(".")[0];
        if (!draftIds.has(id)) {
          rmSync(path.join(dir, name), { force: true });
          removed += 1;
        }
      }
    }
    return { removed };
  }

  function verify() {
    ensure();
    const drafts = listDrafts();
    const issues = [];
    for (const draft of drafts) {
      if (draft.version !== DRAFT_VERSION) issues.push({ id: draft.id, code: "bad_version" });
      for (const rel of draft.source.processedPagePaths ?? []) {
        const abs = resolveStoragePath(rel);
        if (!abs || !existsSync(abs)) issues.push({ id: draft.id, code: "missing_processed_page", rel });
      }
    }
    return { drafts: drafts.length, issues };
  }

  return {
    dirs,
    root,
    ensure,
    createDraft,
    readDraft,
    writeDraft,
    listDrafts,
    resolveStoragePath,
    saveObservation,
    deleteDraft,
    deleteOriginal,
    cleanupOrphans,
    verify,
    sha256Buffer,
  };
}

function guessExt(mimeType) {
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}
