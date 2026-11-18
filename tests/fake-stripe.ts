import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CheckoutRequest, CheckoutSnapshot, PaymentGateway } from "../src/server/payment-gateway.ts";

/** Records checkouts like Stripe would, including idempotent creation per order. */
export class FakeStripe implements PaymentGateway {
  sessions = new Map<string, { request: CheckoutRequest; status: CheckoutSnapshot["status"]; paid: boolean }>();
  creates = 0;
  failNextCreate = false;

  async createCheckout(request: CheckoutRequest) {
    this.creates++;
    if (this.failNextCreate) { this.failNextCreate = false; throw new Error("Simulated network failure"); }
    const existing = [...this.sessions].find(([, session]) => session.request.orderId === request.orderId);
    const id = existing?.[0] ?? `cs_test_${randomUUID().replaceAll("-", "")}`;
    if (!existing) this.sessions.set(id, { request, status: "open", paid: false });
    return { id, url: `https://checkout.stripe.test/c/pay/${id}`, couponId: request.discount ? `coupon_${id.slice(8, 20)}` : null };
  }

  /** What Stripe would charge: line items, minus the one-off coupon, plus the shipping rate. */
  total(request: CheckoutRequest) {
    return request.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)
      - (request.discount?.amountCents ?? 0) + request.shipping.priceCents;
  }

  snapshot(id: string): CheckoutSnapshot {
    const session = this.sessions.get(id);
    assert.ok(session, `unknown session ${id}`);
    const total = this.total(session.request);
    return {
      id, status: session.status, paymentStatus: session.paid ? "paid" : "unpaid", amountTotal: total, currency: "usd",
      orderId: session.request.orderId, paymentIntentId: session.paid ? `pi_${id.slice(8)}` : null,
      chargeId: session.paid ? `ch_${id.slice(8)}` : null, feeCents: session.paid ? Math.round(total * 0.029) + 30 : null,
    };
  }

  request(id: string) {
    const session = this.sessions.get(id);
    assert.ok(session, `unknown session ${id}`);
    return session.request;
  }

  async retrieveCheckout(id: string) { return this.snapshot(id); }

  async expireCheckout(id: string) {
    const session = this.sessions.get(id);
    if (session?.status === "open") session.status = "expired";
    return this.snapshot(id);
  }

  pay(id: string) {
    const session = this.sessions.get(id);
    assert.ok(session && session.status === "open");
    session.status = "complete";
    session.paid = true;
  }
}
