// test/validation.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, toHttpError } from "../src/errors";
import { parseCreateOrder, requireDay } from "../src/validation";

const U = "11111111-1111-4111-8111-111111111111";

function badRequest(fn: () => unknown) {
  assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === 400);
}

test("parseCreateOrder accepts what the cashier screen sends", () => {
  const parsed = parseCreateOrder({
    waiter_id: U,
    created_by: U,
    serving_mode: "shared_tray",
    device_id: "cashier-1",
    local_id: U,
    items: [
      { menu_item_id: U, quantity: 2, comment: "  no sugar  " },
      { menu_item_id: U, quantity: 1, comment: null },
    ],
  });
  assert.equal(parsed.serving_mode, "shared_tray");
  assert.equal(parsed.device_id, "cashier-1");
  assert.deepEqual(parsed.items, [
    { menu_item_id: U, quantity: 2, comment: "no sugar" },
    { menu_item_id: U, quantity: 1, comment: null },
  ]);
  assert.equal(parseCreateOrder({ created_by: U, items: [{ menu_item_id: U, quantity: 1 }] }).serving_mode, "individual");
});

test("parseCreateOrder rejects bad input with 400", () => {
  const item = { menu_item_id: U, quantity: 1 };
  badRequest(() => parseCreateOrder({ created_by: "abc", items: [item] }));
  badRequest(() => parseCreateOrder({ created_by: U, items: [] }));
  badRequest(() => parseCreateOrder({ created_by: U, items: [{ menu_item_id: "x", quantity: 1 }] }));
  badRequest(() => parseCreateOrder({ created_by: U, items: [{ menu_item_id: U, quantity: 1.5 }] }));
  badRequest(() => parseCreateOrder({ created_by: U, items: [{ menu_item_id: U, quantity: 0 }] }));
  badRequest(() => parseCreateOrder({ created_by: U, waiter_id: "x", items: [item] }));
  badRequest(() => parseCreateOrder({ created_by: U, serving_mode: "buffet", items: [item] }));
  badRequest(() => parseCreateOrder({ created_by: U, local_id: "x", items: [item] }));
  badRequest(() => parseCreateOrder(null));
});

test("requireDay only accepts real dates", () => {
  assert.equal(requireDay("2026-11-05", "day"), "2026-11-05");
  badRequest(() => requireDay("2026-02-30", "day"));
  badRequest(() => requireDay("05/11/2026", "day"));
});

test("database errors become safe messages", () => {
  const malformed = toHttpError(
    Object.assign(new Error('invalid input syntax for type uuid: "x"'), { code: "22P02" }),
  );
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(malformed.message, /uuid/);

  const unknown = toHttpError(new Error('relation "secret" does not exist'));
  assert.equal(unknown.status, 500);
  assert.equal(unknown.message, "Something went wrong");

  assert.equal(toHttpError(new Error("timeout exceeded when trying to connect")).status, 503);
});
