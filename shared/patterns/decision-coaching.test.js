import { describe, it, expect } from 'vitest';
import { decisionCoaching } from './decision-coaching.js';
const failure = { verified: true, status: 'incorrect' };
function coaching(replyResult, prediction = { replyUci: 'e7e5' }, result = failure) {
  return decisionCoaching({ result, prediction, replyResult: replyResult && { engineVersion: 'fixture', engineSha256: 'hash', evalCriterionVersion: 'engine-validated-v2', ...replyResult }, predictedSan: 'e5' });
}
describe('decision coaching', () => {
  it('does not diagnose an absent observation or unverified move', () => {
    expect(coaching(null, null)).toBeNull();
    expect(coaching(null, {}, { verified: false })).toBeNull();
  });
  it('treats any verified acceptable reply as anticipated, not only the principal move', () => {
    expect(coaching({ verified: true, status: 'verified_acceptable' })).toMatchObject({ intervention: 'evaluate', hypothesis: 'consequences', confidence: 'single_observation' });
  });
  it('separates a weak prediction from a verified strong defence', () => {
    expect(coaching({ verified: true, status: 'incorrect' }).intervention).toBe('compare');
  });
  it('does not infer a cause from missing or failed verification', () => {
    expect(coaching({ verified: false, status: 'unverified' })).toMatchObject({ intervention: 'uncertain', hypothesis: null });
    expect(coaching({ verified: true, status: 'verified_best', engineSha256: null }).hypothesis).toBeNull();
    expect(coaching(null, { replyUci: null })).toMatchObject({ intervention: 'search', hypothesis: null });
  });
  it('does not infer mastery or a cause from a successful move', () => {
    expect(coaching(null, {}, { verified: true, status: 'verified_acceptable' })).toMatchObject({ intervention: 'reinforce', hypothesis: null });
  });
});
