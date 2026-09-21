import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSku, orderTotal } from "../src/order.js";

test("calculates line-item totals", () => {
  assert.equal(orderTotal([{ price: 12.5, quantity: 2 }]), 25);
});

test("applies a discount to the subtotal", () => {
  assert.equal(orderTotal([{ price: 10, quantity: 2 }], 0.1), 18);
});

test("normalizes product SKUs", () => {
  assert.equal(normalizeSku("  pp-42 "), "PP-42");
});
