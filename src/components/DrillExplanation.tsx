import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExplainFacts, ExplainResult } from "../api/dailyClient";

/** Checked summary from board facts, plus AI wording when it passed verification against the same lines. */
export function FactsSummary({ facts }: { facts: ExplainFacts }) {
  const { t } = useTranslation("daily");
  const piece = (p: string) => t(`pieces.${p}`);
  const parts: string[] = [];
  if (facts.candidateSan && facts.punish?.firstSan) {
    let s = t("explain.candidateAllows", { candidate: facts.candidateSan, reply: facts.punish.firstSan });
    if (facts.punish.firstCaptures && facts.punish.firstCaptureSquare) s += t("explain.captures", { piece: piece(facts.punish.firstCaptures), square: facts.punish.firstCaptureSquare });
    if (facts.punish.firstIsMate) s += t("explain.mate"); else if (facts.punish.firstIsCheck) s += t("explain.check");
    parts.push(s + ".");
    if (facts.punish.attackedAfter.length >= 2) parts.push(t("explain.fork", { list: facts.punish.attackedAfter.map(a => `${piece(a.piece)} ${a.square}`).join(", ") }));
    if (facts.punish.materialSwing >= 2 && !facts.punish.endsInMate) parts.push(t("explain.material", { count: facts.punish.materialSwing }));
    if (facts.best?.firstSan) parts.push(t("explain.best", { move: facts.best.firstSan }));
    parts.push(t("explain.habit"));
  } else if (facts.best) {
    parts.push(t("explain.solution", { line: facts.best.san.join(" ") }));
    if (facts.best.endsInMate) parts.push(t("explain.solutionMate"));
    else if (facts.best.materialSwing >= 2) parts.push(t("explain.solutionMaterial", { count: facts.best.materialSwing }));
  }
  return <p data-testid="facts-summary">{parts.join(" ")}</p>;
}

export function DrillExplanation({ load, showFacts = true }: { load: () => Promise<ExplainResult>; showFacts?: boolean }) {
  const { t } = useTranslation("daily");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ExplainResult | null>(null);
  if (state === "idle") return <button type="button" className="btn ghost" onClick={() => { setState("loading"); load().then(r => { setResult(r); setState("done"); }).catch(() => setState("error")); }}>{t("explain.show")}</button>;
  if (state === "loading") return <p className="muted small" aria-live="polite">{t("explain.loading")}</p>;
  if (state === "error" || !result) return <p className="muted small">{t("explain.status.unavailable")}</p>;
  return <div className="card drill-explain" data-testid="drill-explanation">
    {showFacts && <><h3 className="small muted">{t("explain.template")}</h3><FactsSummary facts={result.facts} /></>}
    {result.llm.text
      ? <><h3 className="small muted">{t("explain.ai")}</h3><p data-testid="ai-explanation">{result.llm.text}</p></>
      : <p className="muted small">{t(`explain.status.${result.llm.status}`, { defaultValue: t("explain.status.unavailable") })}</p>}
  </div>;
}
