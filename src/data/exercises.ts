import type { Exercise } from "./exerciseTypes";
import coreJson from "./generated/exercises.core.json";
import poolJson from "./generated/exercises.pool.json";
import manifest from "./generated/manifest.json";

export type { Exercise } from "./exerciseTypes";

export const dataManifest = manifest;

export const coreExercises = coreJson as Exercise[];
export const poolExercises = poolJson as Exercise[];

/** Núcleo review (5) + banco ampliado desde critical_positions.csv */
export const exercises: Exercise[] = [...coreExercises, ...poolExercises];

export function getExercise(id: string): Exercise | undefined {
  return exercises.find((e) => e.id === id);
}

export function isCoreExercise(id: string): boolean {
  return coreExercises.some((e) => e.id === id);
}
