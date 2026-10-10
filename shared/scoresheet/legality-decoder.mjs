import { Chess } from "chess.js";
import { DEFAULT_DECODER_CONFIG, MAX_PLIES, STANDARD_FEN } from "./constants.mjs";
import { localeTokenVariants, sanToLocaleDisplay } from "./notation.mjs";
import { normalizeToken } from "./normalizer.mjs";
import { resolutionFromCandidates } from "./confidence.mjs";

function textSimilarity(a, b) {
  const left = String(a ?? "").toLowerCase();
  const right = String(b ?? "").toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  let matches = 0;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] === right[i]) matches += 1;
  }
  return matches / max;
}

function legalMoveCandidates(chess, locale) {
  return chess.moves({ verbose: true }).map((move) => {
    const uci = `${move.from}${move.to}${move.promotion ?? ""}`;
    const san = move.san;
    const displayedMove = sanToLocaleDisplay(san, locale);
    const aliases = new Set([san, displayedMove, ...localeTokenVariants(displayedMove, locale)]);
    return { uci, san, displayedMove, aliases: [...aliases] };
  });
}

function scoreTokenAgainstMove(tokenNorm, move, ocrConfidence) {
  let best = 0;
  for (const alias of move.aliases) {
    best = Math.max(best, textSimilarity(tokenNorm, alias));
  }
  const ocr = ocrConfidence ?? 0.7;
  return best * 0.75 + ocr * 0.25;
}

function compareUci(a, b) {
  return a.localeCompare(b);
}

export function decodeScoresheetSequence({
  startingFen = STANDARD_FEN,
  moveRows,
  locale = "en",
  config = DEFAULT_DECODER_CONFIG,
}) {
  const beamWidth = config.beamWidth ?? DEFAULT_DECODER_CONFIG.beamWidth;
  const maxCandidates = config.maxCandidatesPerPly ?? DEFAULT_DECODER_CONFIG.maxCandidatesPerPly;

  let beam = [{
    fen: startingFen,
    plies: [],
    score: 0,
  }];

  const limitedRows = moveRows.slice(0, MAX_PLIES);
  for (const row of limitedRows) {
    const token = row.token;
    const norm = normalizeToken(token.text, { locale });
    const nextBeam = [];

    for (const state of beam) {
      const chess = new Chess(state.fen);
      const legal = legalMoveCandidates(chess, locale);
      const ranked = legal
        .map((move) => ({
          ...move,
          score: scoreTokenAgainstMove(norm.normalized ?? token.text, move, token.confidence),
          reasons: [`text_match`, norm.rules?.length ? "normalized" : "raw"].filter(Boolean),
        }))
        .sort((a, b) => b.score - a.score || compareUci(a.uci, b.uci))
        .slice(0, maxCandidates);

      if (!ranked.length) continue;

      const top = ranked.slice(0, beamWidth);
      for (const candidate of top) {
        const replay = new Chess(state.fen);
        replay.move({ from: candidate.uci.slice(0, 2), to: candidate.uci.slice(2, 4), promotion: candidate.uci[4] });
        const ply = {
          ply: state.plies.length + 1,
          sourceTokenIds: [token.id].filter(Boolean),
          rawText: token.text ?? null,
          normalizedText: norm.normalized,
          candidates: ranked.slice(0, 3).map((row) => ({
            uci: row.uci,
            san: row.san,
            displayedMove: row.displayedMove,
            score: row.score,
            reasons: row.reasons,
          })),
          selectedUci: candidate.uci,
          selectedSan: candidate.san,
          resolution: resolutionFromCandidates(ranked, { ocrConfidence: token.confidence }),
          confirmedByUser: false,
          userConfirmedMove: false,
        };
        nextBeam.push({
          fen: replay.fen(),
          plies: [...state.plies, ply],
          score: state.score + candidate.score,
        });
      }
    }

    nextBeam.sort((a, b) => b.score - a.score || a.plies.length - b.plies.length);
    beam = nextBeam.slice(0, beamWidth);
    if (!beam.length) break;
  }

  const best = beam[0] ?? { plies: [], fen: startingFen, score: 0 };
  return {
    plies: best.plies,
    endingFen: best.fen,
    score: best.score,
    config,
  };
}

export function recomputeFromPly({
  startingFen = STANDARD_FEN,
  plies,
  fromPlyIndex,
  moveRows = [],
  locale = "en",
  config = DEFAULT_DECODER_CONFIG,
}) {
  const preserved = plies.slice(0, fromPlyIndex).map((ply) => ({ ...ply }));
  const chess = new Chess(startingFen);
  for (const ply of preserved) {
    if (!ply.selectedUci) break;
    chess.move({
      from: ply.selectedUci.slice(0, 2),
      to: ply.selectedUci.slice(2, 4),
      promotion: ply.selectedUci[4],
    });
  }

  const tailRows = moveRows.slice(fromPlyIndex);
  const decoded = decodeScoresheetSequence({
    startingFen: chess.fen(),
    moveRows: tailRows,
    locale,
    config,
  });

  const merged = [...preserved];
  for (const ply of decoded.plies) {
    merged.push({ ...ply, ply: merged.length + 1 });
  }

  for (let i = fromPlyIndex; i < merged.length; i += 1) {
    const manual = plies[i];
    if (!manual?.confirmedByUser || !manual.selectedUci) continue;
    const replay = new Chess(startingFen);
    for (let j = 0; j < i; j += 1) {
      const uci = merged[j]?.selectedUci;
      if (!uci) break;
      replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    const ok = replay.move({
      from: manual.selectedUci.slice(0, 2),
      to: manual.selectedUci.slice(2, 4),
      promotion: manual.selectedUci[4],
    });
    if (ok) {
      merged[i] = {
        ...merged[i],
        ...manual,
        resolution: manual.resolution === "manually_entered" ? "manually_entered" : merged[i].resolution,
      };
    } else {
      merged[i] = {
        ...merged[i],
        selectedUci: null,
        selectedSan: null,
        resolution: "ambiguous",
        confirmedByUser: false,
      };
    }
  }

  return merged.slice(0, MAX_PLIES);
}

export function applyManualPlySelection(plies, plyIndex, { uci, san, locale = "en" }) {
  const next = plies.map((ply) => ({ ...ply }));
  next[plyIndex] = {
    ...next[plyIndex],
    selectedUci: uci,
    selectedSan: san,
    resolution: "manually_entered",
    confirmedByUser: true,
    candidates: next[plyIndex]?.candidates ?? [{
      uci,
      san,
      displayedMove: sanToLocaleDisplay(san, locale),
      score: 1,
      reasons: ["manual"],
    }],
  };
  return next;
}
