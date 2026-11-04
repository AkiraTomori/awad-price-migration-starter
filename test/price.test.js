import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice } from '../src/app.js';

test('price conversion keeps legacy precision and rounds integer VND', () => {
  for (const [price, priceVnd] of [[45.5, 45500], [45.1234, 45123], [1.2345, 1235], [0.0005, 1], [100000, 100000000]]) {
    assert.deepEqual(parsePrice({ price }), { price, priceVnd });
    assert.deepEqual(parsePrice({ price, priceVnd }), { price, priceVnd });
  }
  for (const priceVnd of [1, 45501, 100000000])
    assert.deepEqual(parsePrice({ priceVnd }), { price: priceVnd / 1000, priceVnd });
});

test('price validation rejects absent, invalid, unsafe and conflicting values', () => {
  const invalid = [null, [], 'price', {}, { price: null }, { price: '45.5' },
    { price: 0 }, { price: -1 }, { price: NaN }, { price: Infinity },
    { price: 100000.001 }, { price: 0.0001 }, { price: Number.MAX_VALUE },
    { priceVnd: null }, { priceVnd: '45500' }, { priceVnd: 0 }, { priceVnd: -1 },
    { priceVnd: 1.5 }, { priceVnd: Infinity }, { priceVnd: NaN },
    { priceVnd: 100000001 }, { priceVnd: Number.MAX_SAFE_INTEGER + 1 },
    { price: 45.5, priceVnd: 45000 }, { price: null, priceVnd: 45500 },
    { price: 45.5, priceVnd: null }];
  for (const body of invalid) assert.equal(parsePrice(body), null, JSON.stringify(body));
});
