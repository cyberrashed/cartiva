import assert from "node:assert/strict";
import test from "node:test";
import { customerOrders, orderTotals, orderStatus, returnableQuantity, returnWindowEnd, validateReturn, type ReturnRequest } from "./customer-orders.ts";

const splitOrder = customerOrders[1];
const request: ReturnRequest = { id: "DEMO-RETURN-01", orderId: splitOrder.id, lineId: "mugs", quantity: 1, reason: "Arrived damaged", status: "Awaiting review" };

test("order totals use line price snapshots and the recorded delivery amount", () => {
  assert.deepEqual(customerOrders.map(order => orderTotals(order).totalBeforeTax), [15700, 15400, 20800]);
  const updated = { ...splitOrder, lines: splitOrder.lines.map(line => ({ ...line, unitPrice: line.unitPrice + 1 })) };
  assert.equal(orderTotals(updated).totalBeforeTax, 15403);
  assert.deepEqual(orderTotals({ ...splitOrder, lines: [], delivery: 0 }), { merchandise: 0, delivery: 0, totalBeforeTax: 0 });
});

test("separate parcels determine order status and which units can be returned", () => {
  assert.equal(orderStatus(customerOrders[0]), "Preparing");
  assert.equal(orderStatus(splitOrder), "Partially delivered");
  assert.equal(orderStatus(customerOrders[2]), "Delivered");
  assert.equal(returnableQuantity(splitOrder, "mugs", []), 2);
  assert.equal(returnableQuantity(splitOrder, "bag", []), 0);
  assert.equal(returnableQuantity(splitOrder, "unknown", []), 0);
  assert.equal(returnableQuantity(customerOrders[0], "headphones", []), 0);
});

test("pending requests consume return capacity; cancelled and other-order requests do not", () => {
  assert.equal(returnableQuantity(splitOrder, "mugs", [request]), 1);
  assert.equal(returnableQuantity(splitOrder, "mugs", [{ ...request, quantity: 2 }]), 0);
  assert.equal(returnableQuantity(splitOrder, "mugs", [{ ...request, status: "Cancelled" }]), 2);
  assert.equal(returnableQuantity(splitOrder, "mugs", [{ ...request, orderId: "another-order" }]), 2);
});

test("sample return window includes its last day and excludes future deliveries", () => {
  assert.equal(returnWindowEnd("2026-11-06"), "2026-11-20");
  assert.equal(returnableQuantity(splitOrder, "mugs", [], "2026-11-05"), 0);
  assert.equal(returnableQuantity(splitOrder, "mugs", [], "2026-11-20"), 2);
  assert.equal(returnableQuantity(splitOrder, "mugs", [], "2026-11-21"), 0);
});

test("return validation rejects over-returns, fractions, missing reasons and undelivered items", () => {
  const draft = { lineId: "mugs", quantity: 1, reason: "Arrived damaged" };
  assert.deepEqual(validateReturn(splitOrder, [request], draft), {});
  for (const quantity of [0, -1, 1.5, 2, NaN, Infinity]) {
    assert.ok(validateReturn(splitOrder, [request], { ...draft, quantity }).quantity);
  }
  assert.ok(validateReturn(splitOrder, [], { ...draft, reason: "" }).reason);
  assert.ok(validateReturn(splitOrder, [], { ...draft, reason: "invented reason" }).reason);
  assert.ok(validateReturn(splitOrder, [], { ...draft, lineId: "bag" }).lineId);
});

test("sample parcels account for every ordered unit exactly once", () => {
  for (const order of customerOrders) {
    for (const line of order.lines) {
      const allocated = order.parcels.flatMap(parcel => parcel.items).filter(item => item.lineId === line.id).reduce((sum, item) => sum + item.quantity, 0);
      assert.equal(allocated, line.quantity);
    }
  }
});
