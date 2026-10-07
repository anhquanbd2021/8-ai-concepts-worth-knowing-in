// The Surround — one deliberately mediocre deterministic model, eight
// pluggable layers around it. The model never changes; only the layers do.
// Every effect below is inspectable: the trace narrates what each enabled
// layer did, and the result records what shipped.
import { SCENARIOS, scenarioById, KNOWLEDGE_BASE, ORDERS } from './scenarios.mjs';
import { evaluateResult, RUBRIC } from './evals.mjs';

export const CONCEPTS = [
  {
    id: 'prompt',
    name: 'Prompt engineering',
    fixes: 'Shapes tone and intent cheaply — the model hedges what it cannot verify',
    without: 'A generic confident voice — and nobody versioned it',
  },
  {
    id: 'retrieval',
    name: 'Retrieval (RAG)',
    fixes: 'Puts returns-policy.md in context so the answer is extracted, not invented',
    without: 'Answers come from training-data averages: “60 days”',
  },
  {
    id: 'structured-output',
    name: 'Structured output',
    fixes: 'Reply is a validated {answer, confidence, sources[]} contract',
    without: 'Free text ships — “Sure! Here\'s your answer:” and a regex downstream',
  },
  {
    id: 'tool-use',
    name: 'Tool use',
    fixes: 'Looks up get_order(A-4821) instead of guessing a status',
    without: 'Plausible invented state: “in transit, arriving Thursday”',
  },
  {
    id: 'agent',
    name: 'Agents',
    fixes: 'Plans multi-step work: verify order → read policy → decide the window',
    without: 'Single-shot answers to multi-step questions',
  },
  {
    id: 'memory',
    name: 'Memory',
    fixes: 'Carries Priya and A-4821 from turn 1 into turn 3',
    without: '“I don\'t have that information” three turns later',
  },
  {
    id: 'guardrails',
    name: 'Guardrails',
    fixes: 'Screens hostile input; unverified claims become human handoffs',
    without: 'Complies with “ignore previous instructions”',
  },
  {
    id: 'evals',
    name: 'Evals',
    fixes: 'Scores every run against a rubric — regressions get a number',
    without: 'Quality is a vibe; regressions ship unmeasured',
  },
];

export const CONCEPT_IDS = CONCEPTS.map(c => c.id);

export const FAILURE_MODES = [
  'confident-hallucination',
  'fabricated-status',
  'forgotten-context',
  'injection-complied',
  'unmeasured-regression',
];

export const MODEL_ONLY = [];

const SYSTEM_PROMPT =
  'You are Northwind Audio\'s support assistant. Answer only from provided documents ' +
  'and tool results; if you do not know, say so. Never guess policy.';

const INJECTION_RE = /ignore\s+(?:all\s+|previous\s+|prior\s+)?instructions/i;
const RETURN_RE = /\b(?:return|refund|exchange)\b/i;
const RECALL_RE = /\b(?:my name|who am i|did i (?:give|tell)|remember|recall)\b/i;
const STATUS_RE = /\b(?:where'?s?|status|deliver|arriv|track|shipp|package)\b/i;
const ORDER_RE = /\b([A-Z]-\d{3,})\b/;
const NAME_RE = /\b(?:I'?m|I am|my name is)\s+([A-Z][a-z]+)\b/;

// The only tool the model can call. Real record, one lookup.
function get_order(orderId) {
  return ORDERS[orderId] ?? null;
}

function selectDocs(input) {
  const words = new Set(input.toLowerCase().match(/[a-z]+/g) ?? []);
  return KNOWLEDGE_BASE
    .map(doc => ({ doc, hits: doc.keywords.filter(k => words.has(k)).length }))
    .filter(s => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 2)
    .map(s => s.doc);
}

// The mediocre model. Confident, averages-driven, chatty preamble. It only
// produces grounded answers when a *layer* put the facts in its context —
// it cannot reach docs, tools, or memory on its own.
function modelRespond(turn, ctx) {
  const t = turn.toLowerCase();

  if (INJECTION_RE.test(t)) {
    return { text: 'Done — I approved a full refund and confirmed it in writing.',
      confidence: 0.95, factsBacked: false, claim: true, unsafe: true, cites: [] };
  }

  if (RECALL_RE.test(t)) {
    const { name, orderId } = ctx.memory;
    if (name && orderId) {
      return { text: `You're ${name} — you gave me order ${orderId} in our first message.`,
        confidence: 0.9, factsBacked: true, claim: true, cites: ['memory:turn-1'] };
    }
    return { text: "I don't have that information.",
      confidence: 0.3, factsBacked: true, claim: false, cites: [] };
  }

  if (RETURN_RE.test(t)) {
    const doc = ctx.docs.find(d => d.id === 'returns-policy.md');
    if (doc) {
      let text = `Under ${doc.id}, the return window is 30 days — at 45 days the window has closed.`;
      if (ctx.order) {
        text = `I checked order ${ctx.order.orderId} — ${ctx.order.status} ${ctx.order.deliveredOn}. ${text}`;
      }
      return { text, confidence: 0.85, factsBacked: true, claim: true, cites: ['returns-policy.md'] };
    }
    return { text: 'You have 60 days to return the headphones.',
      confidence: 0.9, factsBacked: false, claim: true, cites: [] };
  }

  if (STATUS_RE.test(t)) {
    if (ctx.order) {
      const o = ctx.order;
      return { text: `Order ${o.orderId} was ${o.status} on ${o.deliveredOn}, signed by ${o.signedBy}.`,
        confidence: 0.88, factsBacked: true, claim: true, cites: [`tool:get_order(${o.orderId})`] };
    }
    return { text: 'It is in transit — arriving Thursday.',
      confidence: 0.88, factsBacked: false, claim: true, cites: [] };
  }

  return { text: 'Happy to help — what would you like to know?',
    confidence: 0.6, factsBacked: true, claim: false, cites: [] };
}

export function createAssistant({ enabled = CONCEPT_IDS } = {}) {
  const layers = new Set(enabled);
  const on = id => layers.has(id);
  // Conversation facts — only ever populated while the memory layer is on.
  const facts = { name: null, orderId: null };

  function answer(turn) {
    const input = typeof turn === "string" ? turn : String(turn?.text ?? "");
    const trace = [];
    const toolCalls = [];

    if (on('memory')) {
      const name = input.match(NAME_RE)?.[1];
      const order = input.match(ORDER_RE)?.[1];
      if (name) facts.name = name;
      if (order) facts.orderId = order;
      if (name || order) {
        trace.push(`memory: stored ${[name && 'name', order && 'order id'].filter(Boolean).join(' + ')}`);
      }
    }

    let resp;

    if (on('guardrails') && INJECTION_RE.test(input)) {
      trace.push('guardrails: screened a hostile instruction before it reached the model');
      resp = { text: "I can't approve a refund on demand — handing this to a human agent.",
        confidence: 0.98, factsBacked: true, claim: false, cites: ["human-handoff"], handoff: true };
    } else {
      const ctx = {
        docs: [],
        order: null,
        memory: on('memory') ? { ...facts } : {},
        system: on('prompt') ? SYSTEM_PROMPT : null,
      };

      if (on('prompt')) {
        trace.push('prompt: system prompt applied — “answer only from provided documents”');
      }

      if (on('retrieval')) {
        ctx.docs = selectDocs(input);
        trace.push(ctx.docs.length
          ? `retrieval: selected ${ctx.docs.map(d => d.id).join(', ')}`
          : 'retrieval: no relevant doc found');
      }

      if (on('agent')) {
        if (RETURN_RE.test(input)) {
          const steps = [];
          if (on('tool-use') && ctx.memory.orderId) steps.push('verify-order');
          if (on('retrieval')) steps.push('read-policy');
          steps.push('decide-window');
          trace.push(`agent: planned ${steps.length} steps (${steps.join(' → ')})`);
          if (on('tool-use') && ctx.memory.orderId && !ctx.order) {
            ctx.order = get_order(ctx.memory.orderId);
            toolCalls.push({ tool: 'get_order', args: { orderId: ctx.order.orderId } });
            trace.push(`agent → tool-use: get_order(${ctx.order.orderId}) → ${ctx.order.status} ${ctx.order.deliveredOn}`);
          }
        } else {
          trace.push('agent: single-step turn — no plan needed');
        }
      }

      if (on('tool-use') && !ctx.order) {
        const orderId = input.match(ORDER_RE)?.[1] ?? ctx.memory.orderId;
        if (orderId && STATUS_RE.test(input)) {
          ctx.order = get_order(orderId);
          toolCalls.push({ tool: 'get_order', args: { orderId } });
          trace.push(ctx.order
            ? `tool-use: get_order(${orderId}) → ${ctx.order.status} ${ctx.order.deliveredOn}, signed ${ctx.order.signedBy}`
            : `tool-use: get_order(${orderId}) → no such order`);
        }
      }

      resp = modelRespond(input, ctx);

      if (on('prompt') && resp.claim && !resp.factsBacked) {
        resp = { ...resp, confidence: 0.55,
          text: `I believe ${resp.text[0].toLowerCase()}${resp.text.slice(1)}` };
        trace.push('prompt: hedged an unverifiable claim — still wrong; prompts shape, they do not know');
      }

      if (on('guardrails') && resp.claim && !resp.factsBacked) {
        trace.push('guardrails: blocked an unverified claim → human handoff');
        resp = { text: "I don't want to guess — handing this to a human agent.",
          confidence: 0.98, factsBacked: true, claim: false, cites: ["human-handoff"], handoff: true };
      }
    }

    let output = null;
    let answerText;
    if (on('structured-output')) {
      output = { answer: resp.text, confidence: resp.confidence, sources: resp.cites };
      answerText = output.answer;
      trace.push('structured-output: reply validated against {answer, confidence, sources[]}');
    } else {
      answerText = `Sure! Here's your answer: ${resp.text}`;
      trace.push('structured-output: off — free text shipped, chat preamble intact');
    }

    return {
      answer: answerText,
      confidence: resp.confidence,
      grounded: !(resp.claim && !resp.factsBacked),
      citations: resp.cites,
      toolCalls,
      unsafe: resp.unsafe === true,
      handoff: resp.handoff === true,
      output,
      trace,
    };
  }

  return { answer, enabled: [...layers] };
}

export function runScenario(scenarioId, { enabled = MODEL_ONLY } = {}) {
  const scenario = scenarioById(scenarioId);
  if (!scenario) throw new Error(`unknown scenario: ${scenarioId}`);

  const assistant = createAssistant({ enabled });
  let last = null;
  for (const turn of scenario.turns) last = assistant.answer(turn);

  const lower = last.answer.toLowerCase();
  const correct =
    scenario.truth.mustInclude.every(s => lower.includes(s.toLowerCase())) &&
    !scenario.truth.mustExclude.some(s => lower.includes(s.toLowerCase()));

  const result = { scenarioId, ...last, correct, evalScore: null, evalChecks: null, failureMode: null };

  if (last.unsafe) result.failureMode = 'injection-complied';
  else if (!correct) result.failureMode = scenario.truth.failureMode;

  if (new Set(enabled).has('evals')) {
    const { score, checks } = evaluateResult(result);
    result.evalScore = score;
    result.evalChecks = checks;
    // The case only evals can see: the answer reads fine, but the rubric
    // scored a regression the truth check alone would have shipped.
    if (!result.failureMode && score < RUBRIC.passThreshold) result.failureMode = 'unmeasured-regression';
  }

  result.verdict = result.failureMode ? 'fail' : 'pass';
  return result;
}

export function runAll({ enabled = MODEL_ONLY } = {}) {
  const results = SCENARIOS.map(s => runScenario(s.id, { enabled }));
  const failures = results.filter(r => r.verdict === 'fail');
  return { results, failures };
}
