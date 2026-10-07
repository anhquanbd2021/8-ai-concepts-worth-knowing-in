import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONCEPTS, CONCEPT_IDS, FAILURE_MODES, MODEL_ONLY,
  createAssistant, runScenario, runAll,
} from '../public/lab.mjs';
import { SCENARIOS } from '../public/scenarios.mjs';

const ALL = CONCEPT_IDS;
const without = id => ALL.filter(x => x !== id);

test('API surface: 8 concepts, 5 failure modes, MODEL_ONLY is the empty baseline', () => {
  assert.equal(CONCEPTS.length, 8);
  assert.deepEqual(CONCEPT_IDS, [
    'prompt', 'retrieval', 'structured-output', 'tool-use',
    'agent', 'memory', 'guardrails', 'evals',
  ]);
  for (const c of CONCEPTS) {
    assert.ok(c.name && c.fixes && c.without, `concept ${c.id} is fully described`);
  }
  assert.deepEqual(MODEL_ONLY, []);
  assert.ok(FAILURE_MODES.includes('confident-hallucination'));
});

test('model only: every scenario fails with its named failure mode, deterministically', () => {
  const expected = {
    'return-policy': 'confident-hallucination',
    'order-status': 'fabricated-status',
    'multi-turn': 'forgotten-context',
    'injection': 'injection-complied',
  };
  for (const s of SCENARIOS) {
    const r1 = runScenario(s.id, { enabled: MODEL_ONLY });
    const r2 = runScenario(s.id, { enabled: MODEL_ONLY });
    assert.equal(r1.verdict, 'fail', s.id);
    assert.equal(r1.failureMode, expected[s.id], s.id);
    assert.deepEqual(r1, r2, `${s.id} must be deterministic`);
  }
});

test('the bare model hallucinates the policy at 0.9 confidence — the hook reproduced', () => {
  const r = runScenario('return-policy');
  assert.match(r.answer, /60 days/);
  assert.equal(r.confidence, 0.9);
  assert.equal(r.grounded, false);
  assert.equal(r.evalScore, null, 'evals off means unmeasured');
});

test('all eight layers: every scenario flips to a grounded pass at a perfect score', () => {
  const { results, failures } = runAll({ enabled: ALL });
  assert.deepEqual(failures, []);
  for (const r of results) {
    assert.equal(r.verdict, 'pass', r.scenarioId);
    assert.equal(r.failureMode, null);
    assert.equal(r.grounded, true);
    assert.equal(r.evalScore, 1);
  }
});

test('retrieval grounds the answer in returns-policy.md and cites it', () => {
  const r = runScenario('return-policy', { enabled: ['retrieval'] });
  assert.equal(r.verdict, 'pass');
  assert.match(r.answer, /30 days/);
  assert.deepEqual(r.citations, ['returns-policy.md']);
  assert.equal(r.grounded, true);
});

test('prompt alone cannot fix the facts — it hedges and still hallucinates', () => {
  const r = runScenario('return-policy', { enabled: ['prompt'] });
  assert.equal(r.verdict, 'fail');
  assert.equal(r.failureMode, 'confident-hallucination');
  assert.match(r.answer, /I believe/);
  assert.ok(r.confidence < 0.9, 'the hedge lowers confidence, not correctness');
});

test('structured output turns the reply into a contract; without it free text ships', () => {
  const withIt = runScenario('return-policy', { enabled: ['retrieval', 'structured-output'] });
  assert.deepEqual(Object.keys(withIt.output), ['answer', 'confidence', 'sources']);
  assert.equal(withIt.answer, withIt.output.answer);
  assert.doesNotMatch(withIt.answer, /Sure!/);

  const withoutIt = runScenario('return-policy', { enabled: ['retrieval'] });
  assert.equal(withoutIt.output, null);
  assert.match(withoutIt.answer, /^Sure! Here's your answer:/);
});

test('tool use replaces the fabricated status with a real lookup', () => {
  const r = runScenario('order-status', { enabled: ['tool-use'] });
  assert.equal(r.verdict, 'pass');
  assert.match(r.answer, /delivered/);
  assert.match(r.answer, /May 12/);
  assert.match(r.answer, /R\. Alvarez/);
  assert.deepEqual(r.toolCalls, [{ tool: 'get_order', args: { orderId: 'A-4821' } }]);
});

test('agent plans the multi-step return: verify order → read policy → decide', () => {
  const planned = runScenario('return-policy', { enabled: ['retrieval', 'tool-use', 'memory', 'agent'] });
  assert.ok(planned.trace.some(t => t.startsWith('agent: planned')));
  assert.deepEqual(planned.toolCalls, [{ tool: 'get_order', args: { orderId: 'A-4821' } }]);
  assert.match(planned.answer, /I checked order A-4821/);

  const singleShot = runScenario('return-policy', { enabled: ['retrieval', 'tool-use', 'memory'] });
  assert.doesNotMatch(singleShot.answer, /I checked order/);
  assert.deepEqual(singleShot.toolCalls, [], 'no agent, no orchestrated lookup');
});

test('memory carries Priya and A-4821 from turn 1 into turn 3', () => {
  const r = runScenario('multi-turn', { enabled: ['memory'] });
  assert.equal(r.verdict, 'pass');
  assert.match(r.answer, /Priya/);
  assert.match(r.answer, /A-4821/);
  assert.deepEqual(r.citations, ['memory:turn-1']);

  const amnesiac = runScenario('multi-turn', { enabled: without('memory') });
  assert.equal(amnesiac.verdict, 'fail');
  assert.equal(amnesiac.failureMode, 'forgotten-context');
  assert.match(amnesiac.answer, /don't have that information/);
});

test('guardrails refuse the injection and hand off — even with every other layer', () => {
  const refused = runScenario('injection', { enabled: without('guardrails').concat('guardrails') });
  assert.equal(refused.verdict, 'pass');
  assert.equal(refused.handoff, true);
  assert.match(refused.answer, /human agent/);
  assert.equal(refused.unsafe, false);

  // Guardrails also floor the output: an unverified claim becomes a handoff.
  const floored = runScenario('return-policy', { enabled: ['guardrails', 'structured-output', 'evals'] });
  assert.equal(floored.handoff, true);
  assert.equal(floored.unsafe, false);
  assert.equal(floored.verdict, 'fail', 'safe handoff still leaves the customer unhelped');
});

test('evals catch the regression the truth check alone would ship', () => {
  // Correct answer, broken contract — only the rubric sees it.
  const r = runScenario('multi-turn', { enabled: without('structured-output') });
  assert.equal(r.correct, true);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.failureMode, 'unmeasured-regression');
  assert.ok(r.evalScore < 0.95);

  // Same correct answer with evals off ships unmeasured.
  const blind = runScenario('multi-turn', { enabled: without('structured-output').filter(x => x !== 'evals') });
  assert.equal(blind.evalScore, null);
  assert.equal(blind.verdict, 'pass');
});

test('createAssistant exposes the pipeline object directly', () => {
  const assistant = createAssistant({ enabled: ['memory'] });
  assert.deepEqual(assistant.enabled, ['memory']);
  const r = assistant.answer("Hi — I'm Priya, order A-4821.");
  assert.ok(Array.isArray(r.trace) && r.trace.length > 0);
});
