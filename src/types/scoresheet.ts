export type ScoresheetDraftStatus =
  | "uploaded"
  | "preprocessing"
  | "reading"
  | "review_required"
  | "ready_to_confirm"
  | "confirmed"
  | "imported"
  | "cancelled"
  | "failed";

export type ScoresheetMoveResolution =
  | "high_confidence"
  | "probable"
  | "ambiguous"
  | "unreadable"
  | "manually_entered";

export type ScoresheetMoveCandidate = {
  uci: string;
  san: string;
  displayedMove: string;
  score: number;
  reasons: string[];
};

export type ScoresheetPly = {
  ply: number;
  sourceTokenIds: string[];
  rawText: string | null;
  normalizedText: string | null;
  candidates: ScoresheetMoveCandidate[];
  selectedUci: string | null;
  selectedSan: string | null;
  resolution: ScoresheetMoveResolution;
  confirmedByUser: boolean;
};

export type ScoresheetDraftPublic = {
  id: string;
  version: "scoresheet-draft-v1";
  status: ScoresheetDraftStatus;
  locale: "es" | "en" | "de";
  source: {
    originalFilename: string;
    mimeType: string;
    byteSize: number;
    pageCount: number;
    sha256: string;
    originalAvailable: boolean;
    processedPageCount: number;
    keepOriginal: boolean;
  };
  preprocessing: {
    rotation: number;
    cropped: boolean;
    deskewed: boolean;
    contrastAdjusted: boolean;
    grayscale: boolean;
    version: "scoresheet-preprocess-v1";
    selectedPages?: number[];
  };
  ocr: {
    providerId: string | null;
    providerVersion: string | null;
    completedAt: string | null;
  };
  transcription: {
    startingFen: string;
    plies: ScoresheetPly[];
    result: string | null;
    metadata: Record<string, string | undefined>;
    confirmedAt: string | null;
    confirmedByUser: boolean;
  };
  import: {
    importJobId: string | null;
    canonicalGameId: string | null;
    duplicateDisposition: string | null;
  };
  review?: {
    pendingCount: number;
    unresolvedPlies: number[];
    humanReviewRequired: number;
    readyToConfirm: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
