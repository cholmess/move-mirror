import type { CurriculumDecision, PersonalPattern, PatternSummary } from './patternsClient';
export interface TrainingPlan {
  version: string; evidenceRevision: number; updatedAt: string | null;
  state: 'needs_analysis' | 'personalized' | 'observing';
  coverage: { analyzed: number; eligible: number; decisions: number };
  job: PatternSummary['job'];
  primary: { kind: 'foundation' | 'pattern' | 'retention' | 'resume_lesson' | 'resume_pattern'; patternId: string | null; href: string | null; sessionId: string | null };
  curriculum: Array<CurriculumDecision & { patternId: string }>;
  priorities: Array<{ patternId: string; kind: string; confidence: string; evidence: { errors: number; games: number; opportunities: number }; reason: 'new' | 'review' | 'scheduled' | 'stable'; nextReviewAt: string | null; practice: PersonalPattern['practice']; transfer: PersonalPattern['transfer']; curriculum: CurriculumDecision }>;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/coach/plan${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'connection');
  return data;
}
export const fetchTrainingPlan = () => request<TrainingPlan>('');
export const startTrainingPlan = (patternId?: string) => request<{ href: string }>('/start', { patternId });
