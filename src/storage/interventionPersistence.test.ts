import { describe, expect, it } from "vitest";
import { createInitialState, exportAttempts, importState, markLessonComplete } from "./persistence";

describe("intervention persistence", () => {
  it("round-trips pedagogy events and qualification in the full export", () => {
    const state = markLessonComplete(createInitialState());
    const restored = importState(exportAttempts(state));
    expect(restored.pedagogyEvents).toEqual(state.pedagogyEvents);
    expect(restored.interventionQualification).toEqual(state.interventionQualification);
  });

  it("keeps lesson completion idempotent", () => {
    const once = markLessonComplete(createInitialState());
    const twice = markLessonComplete(once);
    expect(twice.pedagogyEvents.filter((event) => event.eventType === "lesson_completed")).toHaveLength(1);
    expect(twice.progress.lessonCompletedAt).toBe(once.progress.lessonCompletedAt);
  });
});
