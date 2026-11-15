import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let server, chart, records, adapter, shared;
before(async () => {
  server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false } });
  [chart, records, adapter, shared] = await Promise.all([
    server.ssrLoadModule('/src/lib/chartData.ts'),
    server.ssrLoadModule('/src/lib/records.ts'),
    server.ssrLoadModule('/src/lib/recordAdapter.ts'),
    server.ssrLoadModule('/src/components/Shared.tsx'),
  ]);
});
after(async () => server?.close());

const burn = { quantity: 'burning_rate', value: 2, unit: 'unconfirmed', definition: 'FLEX source column' };
const run = (test_number, oxygen_pct, measurements) => ({ test_number, test_identifier: 'shared label', oxygen_pct, measurements });
const experiment = { experiment_id: 'TEST-CS01', psi_id: 'TEST', tests: [
  run(1, 21, [burn, burn, { ...burn, quantity: 'flame_size', value: 65 }]),
  run(2, null, [{ ...burn, value: 4 }]),
  run(3, 19, []),
] };

test('chart groups count unique runs and keep quantities apart', () => {
  const rec = adapter.adaptBackendRecord(experiment);
  const [group] = chart.groupsFor([rec], 'burning_rate');
  assert.equal(group.count, 2);
  assert.notEqual(group.key, records.measurementKey({ ...burn, quantity: 'flame_size' }));
  const [bar] = chart.barData([rec], 'burning_rate', group.key);
  assert.deepEqual([bar.mean, bar.min, bar.max, bar.n, ...bar.err], [3, 2, 4, 2, 1, 1]);
  assert.deepEqual(bar.tests, ['#1 · shared label', '#2 · shared label']);
  const scatter = chart.scatterData([rec], 'burning_rate', group.key, 'oxygen_pct');
  assert.deepEqual(scatter.series[0].points.map((p) => [p.test_number, p.x, p.y]), [[1, 21, 2]]);
  assert.deepEqual(scatter.missingX, ['TEST-CS01 #2 · shared label']);
});

test('invalid readings stay missing and CSV quotes measurement headers', () => {
  const rec = adapter.adaptBackendRecord({ ...experiment, tests: [run(4, Infinity, [{ ...burn, value: NaN }])] });
  assert.equal(rec.tests[0].oxygen_pct, null);
  assert.equal(records.measurementText(rec), 'N/A');
  assert.equal(chart.toCSV([{ 'rate, unconfirmed': 0.2 }]), '"rate, unconfirmed"\n0.2');
});


test('chart frame renders plotted content when the empty-state expression is false', () => {
  const html = renderToStaticMarkup(createElement(shared.ChartFrame, {
    title: 'Recorded oxygen', rows: [{ value: 21 }], csvName: 'oxygen.csv',
    empty: false, children: createElement('svg', { 'aria-label': 'Oxygen chart' }),
  }));
  assert.match(html, /aria-label="Oxygen chart"/);
});
