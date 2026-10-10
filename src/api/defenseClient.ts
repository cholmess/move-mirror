import type {
  DefenseAttempt,
  DefenseFeedbackDto,
  DefensePromptDto,
  DefensiveResource,
} from "../types/defense";

type FeedbackPayload = DefenseFeedbackDto & {
  sourceGameId: string;
  phase: "opening" | "middlegame" | "endgame";
  orientation: "white" | "black";
  moveSan: string;
  moveUci: string;
};

export async function fetchNextDefense(
  attempts: DefenseAttempt[],
  sessionExerciseIds: string[],
): Promise<DefensePromptDto> {
  const response = await fetch("/api/defense/next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attempts, sessionExerciseIds }),
  });
  if (!response.ok) throw new Error("defense_prompt_unavailable");
  const payload = await response.json();
  return payload.exercise as DefensePromptDto;
}

export async function confirmDefense(input: {
  exerciseId: string;
  moveUci: string;
  perceivedThreat: string[];
  perceivedThreatText: string;
  selectedResource: DefensiveResource | "not_sure";
  predictedOpponentReply: string;
  defenseReasoning: string;
  verificationConfirmed: boolean;
}): Promise<FeedbackPayload> {
  const response = await fetch("/api/defense/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("defense_confirmation_failed");
  const payload = await response.json();
  return payload.feedback as FeedbackPayload;
}
