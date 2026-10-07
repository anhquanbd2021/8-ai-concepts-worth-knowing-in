import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticServer } from '../app/server.js';
import { once } from 'node:events';

async function withServer(fn) {
  const server = createStaticServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

test('/health and /version respond; the Lab and Guide pages serve with the nav', async () => {
  await withServer(async base => {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal(await health.text(), 'ok');

    const version = await fetch(`${base}/version`);
    assert.equal(version.status, 200);
    assert.equal((await version.json()).name, '8-ai-concepts-worth-knowing-in-demo');

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    const html = await index.text();
    assert.match(html, /aria-label="Primary"/);
    assert.match(html, /aria-current="page" href="\/"/);
    assert.match(html, /The Surround/);

    const guide = await fetch(`${base}/guide.html`);
    assert.equal(guide.status, 200);
    const guideHtml = await guide.text();
    assert.match(guideHtml, /aria-current="page" href="\/guide\.html"/);

    for (const path of ['/app.js', '/lab.mjs', '/scenarios.mjs', '/evals.mjs', '/styles.css', '/pb-shell.css', '/pb-back.css']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
  });
});

test('/api/meta describes the lab; /api/run reproduces the failure mode end to end', async () => {
  await withServer(async base => {
    const meta = await (await fetch(`${base}/api/meta`)).json();
    assert.equal(meta.concepts.length, 8);
    assert.equal(meta.scenarios.length, 4);
    assert.ok(meta.failureModes.includes('confident-hallucination'));

    // Model only — the lab's whole point, served over HTTP.
    const bare = await (await fetch(`${base}/api/run?scenario=return-policy`)).json();
    assert.equal(bare.verdict, 'fail');
    assert.equal(bare.failureMode, 'confident-hallucination');
    assert.match(bare.answer, /60 days/);

    // All eight layers — same endpoint, same model, flipped verdict.
    const allLayers = 'prompt,retrieval,structured-output,tool-use,agent,memory,guardrails,evals';
    const fixed = await (await fetch(`${base}/api/run?scenario=return-policy&layers=${allLayers}`)).json();
    assert.equal(fixed.verdict, 'pass');
    assert.equal(fixed.evalScore, 1);
    assert.match(fixed.answer, /30 days/);

    const injected = await (await fetch(`${base}/api/run?scenario=injection`)).json();
    assert.equal(injected.failureMode, 'injection-complied');

    const matrix = await (await fetch(`${base}/api/matrix`)).json();
    assert.equal(matrix.results.length, 4);
    assert.equal(matrix.failures.length, 4);

    const bad = await fetch(`${base}/api/run?scenario=nope`);
    assert.equal(bad.status, 400);
  });
});

test('unknown paths and traversal return 404; HEAD works', async () => {
  await withServer(async base => {
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/app/server.js`)).status, 404);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });
});
