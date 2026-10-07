import { SCENARIOS } from '/scenarios.mjs';
import { CONCEPTS, CONCEPT_IDS, MODEL_ONLY, runScenario, runAll } from '/lab.mjs';

const $ = sel => document.querySelector(sel);

const state = {
  scenario: SCENARIOS[0].id,
  enabled: new Set(MODEL_ONLY),
};

/* ---- controls ---------------------------------------------------------- */

function renderScenarioPicker() {
  const picker = $('#scenario-picker');
  picker.innerHTML = '';
  for (const s of SCENARIOS) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="scenario" value="${s.id}"${s.id === state.scenario ? ' checked' : ''}> <span>${s.title}</span>`;
    label.querySelector('input').addEventListener('change', () => {
      state.scenario = s.id;
      refresh();
    });
    picker.appendChild(label);
  }
}

function renderLayerToggles() {
  const wrap = $('#layer-toggles');
  wrap.innerHTML = '';
  for (const c of CONCEPTS) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" value="${c.id}"> <span>${c.name}</span>`;
    const input = label.querySelector('input');
    input.checked = state.enabled.has(c.id);
    input.addEventListener('change', () => {
      input.checked ? state.enabled.add(c.id) : state.enabled.delete(c.id);
      refresh();
    });
    wrap.appendChild(label);
  }
}

function setEnabled(ids) {
  state.enabled = new Set(ids);
  for (const input of document.querySelectorAll('#layer-toggles input')) {
    input.checked = state.enabled.has(input.value);
  }
  refresh();
}

$('#preset-none').addEventListener('click', () => setEnabled(MODEL_ONLY));
$('#preset-all').addEventListener('click', () => setEnabled(CONCEPT_IDS));

/* ---- pipeline cross-section -------------------------------------------- */

function renderPipeline(result) {
  const pipe = $('#pipeline');
  pipe.innerHTML = '';
  for (const c of CONCEPTS) {
    const li = document.createElement('li');
    const lit = state.enabled.has(c.id);
    li.className = `stage layer ${lit ? 'lit' : 'dim'}`;
    li.textContent = c.name;
    li.title = lit ? c.fixes : c.without;
    pipe.appendChild(li);
  }
  const core = document.createElement('li');
  core.className = 'stage core';
  core.textContent = 'MODEL';
  pipe.appendChild(core);
  const out = document.createElement('li');
  out.className = `stage out ${result.verdict}`;
  out.textContent = result.verdict === 'pass' ? 'answer ✓' : 'answer ✗';
  pipe.appendChild(out);

  const v = $('#pipeline-verdict');
  v.textContent = result.verdict === 'pass' ? 'verdict: pass' : `verdict: fail — ${result.failureMode}`;
  v.className = `badge ${result.verdict === 'pass' ? 'pass' : 'warn'}`;
}

/* ---- answer card -------------------------------------------------------- */

function renderAnswer(result) {
  $('#answer-text').textContent = result.answer;

  const pct = Math.round(result.confidence * 100);
  $('#confidence-fill').style.width = `${pct}%`;
  $('#confidence-fill').className = result.confidence >= 0.8 ? 'hi' : result.confidence >= 0.5 ? 'mid' : 'lo';
  $('#confidence-meter').setAttribute('aria-valuenow', String(pct));
  $('#confidence-value').textContent = `${pct}%`;

  const fb = $('#failure-badge');
  if (result.failureMode) {
    fb.textContent = result.failureMode;
    fb.className = 'badge warn';
  } else {
    fb.textContent = 'no failure mode';
    fb.className = 'badge pass';
  }

  $('#fact-grounded').textContent = result.grounded ? 'yes — traced to context' : 'no — unverified claim';
$('#fact-eval').textContent = result.evalScore == null ? 'not measured (evals off)' : String(result.evalScore.toFixed(2)) + ' / 1.00';
  $('#fact-contract').textContent = result.output ? 'valid {answer, confidence, sources[]}' : 'free text — unparsed';

  const cites = $('#citations');
  cites.innerHTML = '';
  for (const c of result.citations) {
    const li = document.createElement('li');
    li.textContent = c;
    cites.appendChild(li);
  }
  if (!result.citations.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = result.handoff ? 'handed to a human agent' : 'no citations — ungrounded';
    cites.appendChild(li);
  }

  const tools = $('#tool-log');
  tools.innerHTML = '';
  for (const t of result.toolCalls) {
    const li = document.createElement('li');
    li.textContent = `${t.tool}(${t.args.orderId})`;
    tools.appendChild(li);
  }

  const trace = $('#trace-log');
  trace.innerHTML = '';
  for (const line of result.trace.length ? result.trace : ['model only — no layers ran']) {
    const li = document.createElement('li');
    li.textContent = line;
    trace.appendChild(li);
  }
}

/* ---- verdict matrix ------------------------------------------------------ */

function renderMatrix() {
  const body = $('#matrix-body');
  body.innerHTML = '';
  const configs = [
    ['model only', MODEL_ONLY],
    ['current', [...state.enabled]],
    ['all eight', CONCEPT_IDS],
  ];
  for (const s of SCENARIOS) {
    const tr = document.createElement('tr');
    const th = document.createElement('td');
    th.innerHTML = `<strong>${s.title}</strong><br><span class="muted">${s.truth.describe}</span>`;
    tr.appendChild(th);
    for (const [, layers] of configs) {
      const r = runScenario(s.id, { enabled: layers });
      const td = document.createElement('td');
      const badge = r.verdict === 'pass' ? 'pass' : 'warn';
      const detail = r.verdict === 'fail' ? r.failureMode : `score ${r.evalScore == null ? '—' : r.evalScore.toFixed(2)}`;
      td.innerHTML = `<span class="badge ${badge}">${r.verdict}</span><br><span class="muted mono">${detail}</span>`;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

$('#run-matrix').addEventListener('click', renderMatrix);

/* ---- refresh ------------------------------------------------------------ */

function refresh() {
  const result = runScenario(state.scenario, { enabled: [...state.enabled] });
  renderPipeline(result);
  renderAnswer(result);
  renderMatrix();
}

renderScenarioPicker();
renderLayerToggles();
refresh();
