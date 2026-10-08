import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultRiskProfile,
  DeterministicRiskEngine,
  type RiskAssessmentInput,
  type RiskProfile,
} from '../src/risk/risk-engine.js';

const baseInput: RiskAssessmentInput = {
  severity: 'MEDIUM',
  confidence: 'MEDIUM',
  evidenceStrength: 'MEDIUM',
  evidenceAuthority: 'AUTHORITATIVE',
  evidenceSufficiency: 'SUFFICIENT',
  evidenceCompleteness: 'COMPLETE',
  reachability: 'UNKNOWN',
  exploitability: 'UNKNOWN',
};

test('severity base points increase monotonically and INFO can have the minimum score', () => {
  const engine = new DeterministicRiskEngine();
  const scores = (['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((severity) =>
    engine.assess({
      ...baseInput,
      severity,
      confidence: 'LOW',
      evidenceStrength: 'LOW',
      evidenceAuthority: 'INVESTIGATIVE',
      evidenceSufficiency: 'INSUFFICIENT',
      evidenceCompleteness: 'INCOMPLETE',
      reachability: 'LOW',
      exploitability: 'LOW',
    }).technicalRisk);
  assert.equal(scores[0], 0);
  assert.ok(scores.every((score, index) => index === 0 || score >= (scores[index - 1] ?? 0)));
});

test('CRITICAL with maximum positive inputs is bounded at 100', () => {
  const result = new DeterministicRiskEngine().assess({
    ...baseInput,
    severity: 'CRITICAL',
    confidence: 'HIGH',
    evidenceStrength: 'HIGH',
    reachability: 'HIGH',
    exploitability: 'HIGH',
  });
  assert.equal(result.technicalRisk, 100);
  assert.equal(result.riskBand, 'CRITICAL');
  assert.equal(result.calculation.rawScore > 100, true);
});

test('confidence and evidence quality affect assessment score without changing severity', () => {
  const engine = new DeterministicRiskEngine();
  const low = engine.assess({
    ...baseInput,
    severity: 'HIGH',
    confidence: 'LOW',
    evidenceStrength: 'LOW',
    evidenceAuthority: 'INVESTIGATIVE',
    evidenceSufficiency: 'UNKNOWN',
    evidenceCompleteness: 'PARTIAL',
  });
  const high = engine.assess({
    ...baseInput,
    severity: 'HIGH',
    confidence: 'HIGH',
    evidenceStrength: 'HIGH',
  });
  assert.equal(low.severity, 'HIGH');
  assert.equal(high.severity, 'HIGH');
  assert.ok(high.technicalRisk > low.technicalRisk);
});

test('reachability and exploitability only affect risk when known', () => {
  const engine = new DeterministicRiskEngine();
  const unknown = engine.assess(baseInput);
  const known = engine.assess({ ...baseInput, reachability: 'HIGH', exploitability: 'HIGH' });
  assert.equal(unknown.factors.reachability.adjustment, 0);
  assert.equal(unknown.factors.exploitability.adjustment, 0);
  assert.ok(known.technicalRisk > unknown.technicalRisk);
  assert.equal(unknown.reachability, 'UNKNOWN');
  assert.equal(unknown.exploitability, 'UNKNOWN');
});

test('unavailable dependency and module-exposure dimensions stay explicit and unscored', () => {
  const result = new DeterministicRiskEngine().assess(baseInput);
  assert.deepEqual(result.factors.dependencyExposure, { value: 'UNKNOWN', adjustment: 0, available: false });
  assert.deepEqual(result.factors.affectedModuleCount, { value: null, adjustment: 0, available: false });
});

test('weak or incomplete evidence reduces assessment confidence but preserves severity', () => {
  const result = new DeterministicRiskEngine().assess({
    ...baseInput,
    severity: 'CRITICAL',
    evidenceStrength: 'LOW',
    evidenceSufficiency: 'UNKNOWN',
    evidenceCompleteness: 'INCOMPLETE',
  });
  assert.equal(result.severity, 'CRITICAL');
  assert.equal(result.evidenceCompleteness, 'INCOMPLETE');
  assert.ok(result.technicalRisk > 0);
  assert.equal(result.riskBand !== 'INFO', true);
});

test('incomplete evidence can never be assessed as sufficient', () => {
  const result = new DeterministicRiskEngine().assess({
    ...baseInput,
    evidenceCompleteness: 'INCOMPLETE',
    evidenceSufficiency: 'SUFFICIENT',
  });
  assert.equal(result.evidenceSufficiency, 'UNKNOWN');
  assert.equal(result.factors.evidenceSufficiency.value, 'UNKNOWN');
  assert.equal(result.factors.evidenceSufficiency.adjustment, 0);
});

test('score bands use deterministic inclusive boundaries', () => {
  const neutralProfile: RiskProfile = {
    ...defaultRiskProfile,
    severityBase: { INFO: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
    adjustments: {
      confidence: { LOW: 0, MEDIUM: 0, HIGH: 0 },
      evidenceStrength: { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
      evidenceAuthority: { AUTHORITATIVE: 0, INVESTIGATIVE: 0, UNKNOWN: 0 },
      evidenceSufficiency: { SUFFICIENT: 0, INSUFFICIENT: 0, UNKNOWN: 0 },
      evidenceCompleteness: { COMPLETE: 0, PARTIAL: 0, INCOMPLETE: 0 },
      reachability: { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
      exploitability: { UNKNOWN: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
    },
  };
  const expected: Array<[number, string]> = [
    [0, 'INFO'], [9, 'INFO'], [10, 'LOW'], [29, 'LOW'], [30, 'MEDIUM'],
    [54, 'MEDIUM'], [55, 'HIGH'], [79, 'HIGH'], [80, 'CRITICAL'], [100, 'CRITICAL'],
  ];
  for (const [score, band] of expected) {
    const profile = {
      ...neutralProfile,
      severityBase: { INFO: score, LOW: score, MEDIUM: score, HIGH: score, CRITICAL: score },
    } satisfies RiskProfile;
    assert.equal(new DeterministicRiskEngine(profile).assess(baseInput).riskBand, band);
  }
});

test('explanation, profile identity, and result are reproducible for identical inputs', () => {
  const engine = new DeterministicRiskEngine();
  const first = engine.assess(baseInput);
  const replay = engine.assess(baseInput);
  assert.deepEqual(first, replay);
  assert.match(first.explanation, /Severity established a base score/);
  assert.match(first.explanation, /Dependency exposure and affected-module count are unavailable/);
  assert.equal(first.profileId, 'default-v1');
  assert.equal(first.profileVersion, 1);
});

test('profile versions are retained as independent score provenance', () => {
  const profile: RiskProfile = { ...defaultRiskProfile, id: 'default-v2', version: 2 };
  const result = new DeterministicRiskEngine(profile).assess(baseInput);
  assert.equal(result.profileId, 'default-v2');
  assert.equal(result.profileVersion, 2);
  assert.equal(result.profileSnapshot.id, 'default-v2');
  assert.equal(result.profileSnapshot.version, 2);
});

test('invalid factor values, profile weights, bands, and score results are rejected', () => {
  const engine = new DeterministicRiskEngine();
  assert.throws(() => engine.assess({ ...baseInput, severity: 'SEVERE' as RiskAssessmentInput['severity'] }), /Invalid risk factor severity/);
  assert.throws(() => engine.assess({ ...baseInput, exploitability: 'EXTREME' as RiskAssessmentInput['exploitability'] }), /Invalid risk factor exploitability/);
  assert.throws(() => new DeterministicRiskEngine({
    ...defaultRiskProfile,
    severityBase: { ...defaultRiskProfile.severityBase, HIGH: Number.NaN },
  }), /Invalid base score/);
  assert.throws(() => new DeterministicRiskEngine({
    ...defaultRiskProfile,
    bands: [{ band: 'INFO', minimum: -1, maximum: 100 }],
  }), /must cover scores from 0 through 100|invalid score band/);
  const invalidProfile = {
    ...defaultRiskProfile,
    adjustments: {
      ...defaultRiskProfile.adjustments,
      confidence: { ...defaultRiskProfile.adjustments.confidence, HIGH: Number.POSITIVE_INFINITY },
    },
  };
  assert.throws(() => new DeterministicRiskEngine(invalidProfile), /Invalid confidence adjustment/);
});
