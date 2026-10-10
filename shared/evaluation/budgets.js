export const EVAL_CRITERION_ID = "engine-validated-v2";
export const EVAL_PIPELINE_VERSION = "eval-pipeline-v0.2.1";

export const BUDGET_SHALLOW = Object.freeze({
  id: "nodes-80k-v1",
  nodes: 80_000,
  threads: 1,
  hashMb: 128,
});

export const BUDGET_DEEP = Object.freeze({
  id: "nodes-500k-v1",
  nodes: 500_000,
  threads: 1,
  hashMb: 128,
});
