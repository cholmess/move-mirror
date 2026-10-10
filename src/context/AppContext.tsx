import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppState, AttemptRecord, CctCapture } from "../types/learning";
import {
  loadState,
  saveState,
  recordAttempt,
  markLessonComplete,
  resetProgress,
} from "../storage/persistence";
import { EVAL_CRITERION_VERSION, LESSON_VERSION } from "../data/constants";
import { getExercise } from "../data/exercises";
import { isLegalMove, userFoundForcedResponse } from "../domain/evaluation";
import { evaluateMoveWithEngine, type EvaluateResult } from "../api/engineClient";
import {
  buildReflectionPrompt,
} from "../domain/pedagogy";
import type { EvaluationStatus } from "@shared/evaluation/types";

interface AppContextValue {
  state: AppState;
  persist: (next: AppState) => void;
  submitExerciseAttempt: (params: {
    exerciseId: string;
    cct: CctCapture;
    chosenMoveSan: string;
    reasoning: string;
    timeUsedSeconds: number;
  }) => Promise<AttemptRecord | null>;
  completeLesson: () => void;
  resetAll: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadState());

  const persist = useCallback((next: AppState) => {
    setState(next);
    saveState(next);
  }, []);

  const submitExerciseAttempt = useCallback(
    async (params: {
      exerciseId: string;
      cct: CctCapture;
      chosenMoveSan: string;
      reasoning: string;
      timeUsedSeconds: number;
    }): Promise<AttemptRecord | null> => {
      const exercise = getExercise(params.exerciseId);
      if (!exercise) return null;

      const priorAttempts = state.attempts.filter(
        (a) => a.exerciseId === params.exerciseId
      );
      const attemptNumber = priorAttempts.length + 1;

      let evaluationStatus: EvaluationStatus = "unverified";
      let evalVerified = false;
      let evalLossCp: number | null = null;
      let engineVersion: string | null = null;
      let engineSha256: string | null = null;
      let opponentReplySan: string | null = null;
      let evalMeta: EvaluateResult | null = null;

      if (!isLegalMove(exercise.fen, params.chosenMoveSan)) {
        evaluationStatus = "illegal";
        evalVerified = true;
      } else {
        evalMeta = await evaluateMoveWithEngine({
          fen: exercise.fen,
          moveSan: params.chosenMoveSan,
          referenceBestUci: exercise.referenceMoveUci,
        });
        evaluationStatus = evalMeta.status;
        evalVerified = evalMeta.verified;
        evalLossCp = evalMeta.cpLoss;
        engineVersion = evalMeta.engineVersion;
        engineSha256 = evalMeta.engineSha256;
        opponentReplySan = evalMeta.opponentReplySan;
      }

      const foundOpponentForcedResponse = userFoundForcedResponse(
        params.cct.opponentForcedResponse,
        exercise
      );

      const reflectionPrompt = buildReflectionPrompt(exercise, evaluationStatus);

      const next = recordAttempt(state, {
        exerciseId: params.exerciseId,
        patternId: exercise.patternId,
        skillIds: exercise.skillIds,
        fen: exercise.fen,
        cct: params.cct,
        chosenMoveSan: params.chosenMoveSan,
        reasoning: params.reasoning,
        timeUsedSeconds: params.timeUsedSeconds,
        evaluationStatus,
        evalLossCp,
        engineVersion,
        engineSha256,
        evalVerified,
        observableReason: exercise.observableReason ?? null,
        opponentReplySan,
        reflectionPrompt,
        attemptNumber,
        foundOpponentForcedResponse,
        lessonVersion: LESSON_VERSION,
        evalCriterionVersion: EVAL_CRITERION_VERSION,
        evalPipelineVersion: evalMeta?.evalPipelineVersion,
        evalInitialBudgetId: evalMeta?.evalInitialBudgetId,
        evalFinalBudgetId: evalMeta?.evalFinalBudgetId,
        evalEscalated: evalMeta?.evalEscalated,
        evalEscalationReason: evalMeta?.evalEscalationReason ?? null,
        evalInitialStatus: evalMeta?.evalInitialStatus ?? null,
        evalFinalStatus: evalMeta?.evalFinalStatus,
        cacheHit: evalMeta?.cacheHit,
      });

      persist(next);
      return next.attempts[next.attempts.length - 1] ?? null;
    },
    [state, persist]
  );

  const completeLesson = useCallback(() => {
    persist(markLessonComplete(state));
  }, [state, persist]);

  const resetAll = useCallback(() => {
    persist(resetProgress());
  }, [persist]);

  const value = useMemo(
    () => ({
      state,
      persist,
      submitExerciseAttempt,
      completeLesson,
      resetAll,
    }),
    [state, persist, submitExerciseAttempt, completeLesson, resetAll]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
