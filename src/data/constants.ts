/** Versiones de contenido y criterios — incrementar al cambiar lecciones o evaluación. */
export const LESSON_VERSION = "cct-refutation-v1";
export const EVAL_CRITERION_VERSION = "engine-validated-v2";

export const PLAYER_USERNAME = "cholmess21";
export const PRODUCT_TAGLINE = "The chess coach that learns how you play.";

export const PATTERN_ID = "cct-opponent-refutation" as const;

export const APP_STATE_VERSION = 2 as const;
export const LEGACY_STATE_VERSION = 1 as const;

export const ENGINE_API =
  import.meta.env.VITE_ENGINE_API ?? "http://127.0.0.1:8787";
