import fs from "node:fs";
import crypto from "node:crypto";
import { Chess } from "chess.js";
import { selectDefenseExercise } from "../../shared/defense/adaptive.js";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function promptDto(exercise, reason, dataset = null) {
  return {
    exerciseId: exercise.id,
    fen: exercise.positionBeforeDecisionFen,
    orientation: exercise.orientation,
    phase: exercise.phase,
    sourceContext: {
      playedAt: exercise.source.playedAt,
      playerColor: exercise.source.playerColor,
      moveNumber: exercise.sourceContext.moveNumber,
      opening: exercise.sourceContext.opening ?? null,
    },
    previousMoveSan: exercise.source.previousMoveSan,
    promptKey: "default",
    selectionReason: reason,
    ...(dataset?.selection
      ? {
          dataset: {
            releaseVersion: dataset.releaseVersion,
            selectionVersion: dataset.selection.version,
            selected: dataset.selection.selected,
            technicallyEligible: dataset.selection.technicallyEligible,
            candidatesAnalyzed: dataset.selection.candidatesAnalyzed,
          },
        }
      : {}),
  };
}

function moveFromRequest(fen, input) {
  const chess = new Chess(fen);
  const move = input.moveUci
    ? chess.move({
        from: input.moveUci.slice(0, 2),
        to: input.moveUci.slice(2, 4),
        promotion: input.moveUci[4],
      })
    : chess.move(input.moveSan);
  return move ? { san: move.san, uci: `${move.from}${move.to}${move.promotion ?? ""}` } : null;
}

export function createDefenseRouter({ datasetFile, evaluate }) {
  let dataset = null;
  function data() {
    if (!dataset) dataset = JSON.parse(fs.readFileSync(datasetFile, "utf8"));
    return dataset;
  }
  function exercises() {
    return data().exercises;
  }

  return async function route(req, res) {
    if (req.url === "/api/defense/next" && req.method === "POST") {
      try {
        const input = await body(req);
        const selection = selectDefenseExercise(
          exercises(),
          Array.isArray(input.attempts) ? input.attempts : [],
          Array.isArray(input.sessionExerciseIds) ? input.sessionExerciseIds : [],
        );
        if (!selection.exercise) {
          json(res, 404, { ok: false, error: "no_defense_exercise" });
          return true;
        }
        json(res, 200, {
          ok: true,
          exercise: promptDto(selection.exercise, selection.reason, data()),
        });
      } catch (error) {
        json(res, 503, { ok: false, error: `defense_dataset_unavailable:${error.message}` });
      }
      return true;
    }

    if (req.url === "/api/defense/confirm" && req.method === "POST") {
      try {
        const input = await body(req);
        const exercise = exercises().find((item) => item.id === input.exerciseId);
        if (!exercise) {
          json(res, 404, { ok: false, error: "exercise_not_found" });
          return true;
        }
        const move = moveFromRequest(exercise.positionBeforeDecisionFen, input);
        if (!move) {
          json(res, 200, {
            ok: true,
            feedback: {
              exerciseId: exercise.id,
              evaluationStatus: "illegal",
              evaluationId: null,
              cpLoss: null,
            },
          });
          return true;
        }
        const result = await evaluate(
          {
            fen: exercise.positionBeforeDecisionFen,
            moveUci: move.uci,
            referenceBestUci: exercise.referenceDefenseUci,
          },
          undefined,
        );
        const evaluationId = result.verified
          ? crypto
              .createHash("sha256")
              .update(`${exercise.id}|${move.uci}|${result.engineSha256}|${result.evalFinalBudgetId}`)
              .digest("hex")
              .slice(0, 24)
          : null;
        json(res, 200, {
          ok: true,
          feedback: {
            exerciseId: exercise.id,
            evaluationStatus: result.status,
            evaluationId,
            cpLoss: result.cpLoss,
            opponentReplySan: result.opponentReplySan,
            threat: exercise.opponentThreat,
            motif: exercise.motif,
            referenceDefenseSan: exercise.referenceDefenseSan,
            actualPlayedMoveSan: exercise.actualPlayedMoveSan,
            actualPunishmentLineSan: exercise.actualPunishmentLineSan,
            defenseReferenceLineSan: exercise.defenseReferenceLineSan,
            pedagogy: exercise.pedagogy,
            sourceGameId: exercise.source.gameId,
            phase: exercise.phase,
            orientation: exercise.orientation,
            moveSan: move.san,
            moveUci: move.uci,
            technical: {
              criterionVersion: result.evalCriterionVersion,
              pipelineVersion: result.evalPipelineVersion,
              budgetId: result.evalFinalBudgetId,
              engineSha256: result.engineSha256,
            },
          },
        });
      } catch (error) {
        json(res, 500, { ok: false, error: `defense_confirmation_failed:${error.message}` });
      }
      return true;
    }
    return false;
  };
}
