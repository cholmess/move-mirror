import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { deterministicHash } from "./selection.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/defense/manifest.json"), "utf8"),
);
const dataset = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/defense/defense-lab-v1.json"), "utf8"),
);
const ranking = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/defense/defense-ranking-v1.json"), "utf8"),
);

describe("Defense v0.4.1 artifacts", () => {
  it("accounts for all 151 candidates with exactly one disposition", () => {
    const counts = manifest.counts;
    expect(counts.candidatesFound).toBe(151);
    expect(counts.candidatesFound).toBe(
      counts.candidatesAnalyzed + counts.analysisFailed,
    );
    expect(counts.candidatesAnalyzed).toBe(
      counts.technicallyEligible + counts.rejectedByQuality,
    );
    expect(counts.technicallyEligible).toBe(
      counts.selected + counts.eligibleNotSelected,
    );
    expect(manifest.accountingValid).toBe(true);
    expect(ranking.candidates).toHaveLength(151);
    expect(new Set(ranking.candidates.map((item) => item.candidateId)).size).toBe(151);
  });

  it("contains only the 24 selected active exercises in the adaptive dataset", () => {
    expect(dataset.exercises).toHaveLength(24);
    expect(dataset.exercises.every((exercise) => exercise.lifecycle === "active")).toBe(true);
    expect(dataset.exercises.map((exercise) => exercise.id)).toEqual(
      manifest.selectedIds,
    );
    expect(new Set(dataset.exercises.map((exercise) => exercise.source.gameId)).size)
      .toBe(24);
  });

  it("has stable hashes independent of generatedAt", () => {
    const { generatedAt: _datasetGeneratedAt, ...datasetContent } = dataset;
    expect(deterministicHash(datasetContent)).toBe(manifest.selectedDatasetSha256);
    const { generatedAt: _rankingGeneratedAt, ...rankingContent } = ranking;
    expect(deterministicHash(rankingContent)).toBe(manifest.fullRankingSha256);
  });

  it("records a concrete reason for every non-selected candidate", () => {
    for (const candidate of ranking.candidates.filter((item) => !item.selected)) {
      expect(candidate.disposition).toBeTruthy();
      expect(candidate.reasons?.length).toBeGreaterThan(0);
    }
  });

  it("archives v0.4.0 exercises that left the active selection", () => {
    expect(manifest.changesFromV040.entered).toHaveLength(8);
    expect(manifest.changesFromV040.exited).toHaveLength(8);
    expect(ranking.archivedExercises).toHaveLength(8);
    expect(
      ranking.archivedExercises.every(
        (exercise) => exercise.lifecycle === "archived_not_selected",
      ),
    ).toBe(true);
  });
});
