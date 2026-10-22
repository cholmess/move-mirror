import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchTrainingPlan, startTrainingPlan, type TrainingPlan as Plan } from '../api/trainingPlanClient';
import { updatePatterns, cancelPatternUpdate } from '../api/patternsClient';

export function TrainingPlan() {
  const { t, i18n } = useTranslation(['coach', 'patterns']);
  const navigate = useNavigate();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    const result = await fetchTrainingPlan();
    if (mounted.current) { setPlan(result); setError(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(); } catch { if (mounted.current) setError(true); }
      if (!cancelled) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); };
  }, [refresh]);
  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false);
    try { await fn(); } catch { if (mounted.current) setError(true); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function start(patternId?: string) {
    const result = await startTrainingPlan(patternId);
    if (mounted.current) navigate(result.href);
  }
  const analyzing = plan && ['running', 'queued'].includes(plan.job.status);
  return <section className="card training-plan" data-testid="training-plan">
    <p className="eyebrow">{t('coach:plan.eyebrow')}</p>
    <h1>{t('coach:plan.title')}</h1>
    {error && <p role="alert">{t('coach:plan.error')} <button className="btn" disabled={busy} onClick={() => void act(refresh)}>{t('coach:plan.reload')}</button></p>}
    {!plan && !error && <p role="status">{t('patterns:loading')}</p>}
    {plan && <>
      <p data-testid="plan-coverage">{t('patterns:coverage', plan.coverage)}</p>
      {plan.state !== 'personalized' && <p>{t(`coach:plan.${plan.state}`)}</p>}
      <div className="callout">
        <h2 data-testid="plan-focus">{plan.primary.patternId ? t(`patterns:catalog.${plan.primary.patternId}.title`) : t(`coach:plan.focus.${plan.primary.kind}`)}</h2>
        <p>{plan.primary.patternId
          ? t(`coach:plan.curriculum.action.${plan.priorities.find(p => p.patternId === plan.primary.patternId)?.curriculum.action ?? 'diagnose'}`)
          : t('coach:plan.generalNote')}</p>
        <button className="btn primary" data-testid="plan-start" disabled={busy || error} onClick={() => void act(() => start())}>{t(`coach:plan.action.${plan.primary.kind}`)}</button>
      </div>
      {plan.priorities.length > 0 && <>
        <h2>{t('coach:plan.priorities')}</h2>
        <p>{t('coach:plan.method')}</p>
        <div className="practice-cards">{plan.priorities.map(p => <article className="card" key={p.patternId} data-testid={`plan-${p.patternId}`}>
          <h3>{t(`patterns:catalog.${p.patternId}.title`)}</h3>
          <p>{t('patterns:evidence', p.evidence)}</p>
          <p>{t(`patterns:confidence.${p.confidence}`)} · {t(`coach:plan.reason.${p.reason}`)}</p>
          <p data-testid={`curriculum-${p.patternId}`}><strong>{t(`coach:plan.curriculum.slot.${p.curriculum.slot ?? 'support'}`)}:</strong> {t(`coach:plan.curriculum.action.${p.curriculum.action}`)}</p>
          <p className="small muted">{t(`coach:plan.curriculum.reason.${p.curriculum.reasonKey}`)}</p>
          {p.nextReviewAt && <p>{t('coach:plan.reviewDate', { date: new Date(p.nextReviewAt).toLocaleDateString(i18n.language) })}</p>}
          {p.kind === 'context' && <p>{t('patterns:causeUnknown')}</p>}
          {p.practice.attempts > 0 && <p>{t('patterns:practiceEvidence', p.practice)}</p>}
          <p>{p.transfer.status === 'insufficient' ? t('patterns:transferPending') : t('patterns:transferObserved', { before: p.transfer.before.ratePer100?.toFixed(1), after: p.transfer.after.ratePer100?.toFixed(1) })}</p>
          <button className="btn" disabled={busy || error} onClick={() => void act(() => start(p.patternId))}>{t('patterns:practice')}</button>
        </article>)}</div>
      </>}
      <div className="btn-row">
        <button className="btn" disabled={busy || !!analyzing} onClick={() => void act(async () => { await updatePatterns(); await refresh(); })}>{t('patterns:update')}</button>
        {analyzing && <button className="btn" disabled={busy} onClick={() => void act(async () => { await cancelPatternUpdate(); await refresh(); })}>{t('patterns:cancel')}</button>}
        <Link className="btn" to="/patterns">{t('patterns:all')}</Link>
        <Link className="btn" to="/import">{t('patterns:import')}</Link>
      </div>
      {analyzing && <p role="status">{t('patterns:progress', { done: plan.job.completedDecisions, total: plan.job.totalDecisions })}</p>}
      {plan.job.error && <p role="alert">{t(`patterns:errors.${plan.job.error}`, { defaultValue: t('patterns:errors.connection') })}</p>}
    </>}
  </section>;
}
