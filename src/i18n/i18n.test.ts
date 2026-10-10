import { describe, expect, it, beforeEach, vi } from "vitest";
import { i18n, setAppLocale } from "./i18nInstance";
import { readStoredLocale, writeStoredLocale } from "./localeStorage";
import { resolveInitialLocale } from "./resolveLocale";
import {
  formatEvaluationStatus,
  formatMoveForDisplay,
  formatExercisePrompt,
  moveAriaLabel,
} from "./presenters";
import { selectNextExercise } from "../domain/adaptive";
import { createInitialState } from "../storage/persistence";

const mem: Record<string, string> = {};

describe("i18n locale", () => {
  beforeEach(() => {
    for (const k of Object.keys(mem)) delete mem[k];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
      removeItem: (k: string) => {
        delete mem[k];
      },
      clear: () => {
        for (const k of Object.keys(mem)) delete mem[k];
      },
    });
  });

  it("resolves browser es-* to es", () => {
    vi.stubGlobal("navigator", { languages: ["es-CL", "en"] });
    expect(resolveInitialLocale()).toBe("es");
  });

  it("falls back to en for unknown browser language", () => {
    vi.stubGlobal("navigator", { languages: ["fr-FR"] });
    expect(resolveInitialLocale()).toBe("en");
  });

  it("persists locale preference", () => {
    writeStoredLocale("de");
    expect(readStoredLocale()).toBe("de");
  });

  it("changes language live", async () => {
    setAppLocale("es");
    await i18n.changeLanguage("es");
    expect(i18n.language).toBe("es");
    expect(formatEvaluationStatus("verified_best", "es")).toMatch(/mejor/i);
    setAppLocale("en");
    await i18n.changeLanguage("en");
    expect(formatEvaluationStatus("verified_best", "en")).toMatch(/Best option/i);
  });

  it("has core keys in all locales", () => {
    for (const lng of ["en", "es", "de"] as const) {
      const t = i18n.getFixedT(lng);
      expect(t("common:evaluationStatus.verified_best")).toBeTruthy();
      expect(t("navigation:home")).toBeTruthy();
    }
  });

  it("formats moves with piece symbols", () => {
    expect(formatMoveForDisplay("Nf3", "en")).toBe("♘f3");
    expect(moveAriaLabel("Nf3", "en")).toMatch(/knight|Knight/i);
  });

  it("formats exercise prompt with interpolation", () => {
    const en = formatExercisePrompt("Be4", "en");
    const es = formatExercisePrompt("Be4", "es");
    expect(en).toMatch(/Be4|♗e4/);
    expect(es).toMatch(/partida|played/i);
  });

  it("same state + different locale = same domain result", () => {
    const state = createInitialState();
    const en = selectNextExercise(state);
    setAppLocale("de");
    const de = selectNextExercise(state);
    setAppLocale("es");
    const es = selectNextExercise(state);
    expect(de.exercise.id).toBe(en.exercise.id);
    expect(es.exercise.id).toBe(en.exercise.id);
    expect(de.reasons.map((r) => r.key)).toEqual(en.reasons.map((r) => r.key));
  });
});
