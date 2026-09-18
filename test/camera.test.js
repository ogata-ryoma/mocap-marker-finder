import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasTorch, zoomRange } from '../camera.js';

test('hasTorch は boolean true と配列 [true] を受け付ける', () => {
  assert.equal(hasTorch({ torch: true }), true);
  assert.equal(hasTorch({ torch: [true] }), true);
  assert.equal(hasTorch({ torch: [false, true] }), true);
});

test('hasTorch は無い、false、[false] を拒む', () => {
  assert.equal(hasTorch({}), false);
  assert.equal(hasTorch({ torch: false }), false);
  assert.equal(hasTorch({ torch: [false] }), false);
});

test('zoomRange は min/max/step を返し、無ければ null', () => {
  assert.deepEqual(zoomRange({ zoom: { min: 1, max: 5, step: 0.5 } }), { min: 1, max: 5, step: 0.5 });
  assert.deepEqual(zoomRange({ zoom: { max: 3 } }), { min: 1, max: 3, step: 0.1 });
  assert.equal(zoomRange({}), null);
  assert.equal(zoomRange({ zoom: {} }), null);
});
