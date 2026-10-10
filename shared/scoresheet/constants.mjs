export const DRAFT_VERSION = "scoresheet-draft-v1";
export const PREPROCESS_VERSION = "scoresheet-preprocess-v1";
export const NORMALIZER_VERSION = "scoresheet-token-normalizer-v1";
export const DECODER_VERSION = "scoresheet-legality-decoder-v1";
export const CONFIDENCE_VERSION = "scoresheet-confidence-v1";

export const STANDARD_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const MAX_FILE_BYTES = Number(process.env.SCORESHEET_MAX_BYTES ?? 20 * 1024 * 1024);
export const MAX_PAGES = Number(process.env.SCORESHEET_MAX_PAGES ?? 2);
export const MAX_PLIES = 200;
export const MAX_DECODED_PIXELS = Number(process.env.SCORESHEET_MAX_PIXELS ?? 24_000_000);

export const DEFAULT_DECODER_CONFIG = {
  version: DECODER_VERSION,
  beamWidth: 8,
  maxCandidatesPerPly: 12,
  autoAcceptThreshold: 0.92,
  ambiguityGap: 0.08,
};

export const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "image/heic",
  "image/heif",
]);
