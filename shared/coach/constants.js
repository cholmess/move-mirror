export const COACH_PROTOCOL_ID = "candidate-refutation-teaching-v2";
export const COACH_DOSE_PROTOCOL_ID = "candidate-refutation-teaching-dose-v2";
export const COACH_LESSON_SPEC_VERSION = "coach-lesson-qg4-v1";
export const COACH_SKILL_ID = "candidate-refutation-hostile-reply";
export const COACH_PATTERN_ID = "cct-opponent-refutation";

/** Minimum coach v2 exposure before transfer cohort may use this protocol. */
export const COACH_DOSE_REQUIREMENTS = {
  lessonCompleted: true,
  workedExampleCompleted: true,
  practiceIndependentSuccess: true,
  holdoutFirstAttemptCompleted: true,
  exitRuleRecorded: true,
};

export const COACH_PHASES = [
  "intro",
  "worked_apply",
  "worked_find_reply",
  "probe_self",
  "probe_task",
  "explore",
  "practice",
  "holdout",
  "exit_rule",
  "summary",
  "retention_scheduled",
];

export const PROBE_ANSWERS = ["not_seen", "saw_but_continued", "saw_on_board"];

export const HINT_LADDER_MAX = 4;
