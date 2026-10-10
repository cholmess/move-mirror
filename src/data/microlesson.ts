import { exercises } from "./exercises";

export interface MicroLessonStep {
  order: number;
  title: string;
  body: string;
  /** Referencia a ejercicio real de cholmess21, sin revelar solución */
  exampleExerciseId?: string;
  checklist?: string[];
}

export const microLesson = {
  id: "lesson-cct-refutation-v1",
  title: "CCT + refutación en 20–30 segundos",
  durationMinutes: "5–10",
  steps: [
    {
      order: 1,
      title: "Jaque",
      body: "Antes de mover en una posición no trivial, pregúntate: ¿tengo algún jaque útil? Si ya tengo un candidato, ¿qué jaque tiene el rival justo después?",
      exampleExerciseId: "ex-183971526340-m42",
      checklist: [
        "Listar jaques propios posibles",
        "Tras tu candidato, imaginar el jaque rival más incómodo",
      ],
    },
    {
      order: 2,
      title: "Captura",
      body: "¿Qué puedo capturar ahora? Si capturo, ¿cuál es la recaptura y qué queda atacado o colgado?",
      exampleExerciseId: "ex-174197859140-m29",
      checklist: [
        "Capturas propias en el tablero",
        "Recaptura y piezas que quedan expuestas",
      ],
    },
    {
      order: 3,
      title: "Amenaza",
      body: "¿Cuál es la amenaza más fuerte de cada bando? No la más bonita: la que cambia el equilibrio material o de seguridad del rey.",
      exampleExerciseId: "ex-184070622900-m20",
    },
    {
      order: 4,
      title: "Respuesta más incómoda del rival",
      body: "Imagina que el rival conoce tu idea. Busca su respuesta más desagradable — captura forzada, jaque, intermezzo — no la jugada natural que esperas.",
      exampleExerciseId: "ex-184215932040-m26",
    },
    {
      order: 5,
      title: "Verificación final",
      body: "Solo entonces confirma la jugada. En tu nivel, una línea hostil de 1–2 respuestas vale más que una variante larga y elegante que no refutaste.",
      exampleExerciseId: "ex-174256061220-m61",
      checklist: [
        "¿Mi jugada sobrevive a la mejor respuesta forzada del rival?",
        "¿Generé jaques y capturas antes de un plan tranquilo?",
      ],
    },
  ] satisfies MicroLessonStep[],
};

export function getLessonExampleFen(step: MicroLessonStep): string | undefined {
  if (!step.exampleExerciseId) return undefined;
  return exercises.find((e) => e.id === step.exampleExerciseId)?.fen;
}
