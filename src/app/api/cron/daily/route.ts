import { timingSafeEqual } from "node:crypto";
import { invalidateCatalog } from "@/server/catalog-cache";
import { invalidateShipping } from "@/server/checkout-settings-cache";
import { demoMode, resetDemoStore } from "@/server/demo";
import { releaseExpiredReservations } from "@/server/orders";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Daily job (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`): releases
 * expired stock holds Stripe has not reported yet, and in the public demo resets
 * the sample store and removes day-old orders.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const released = await releaseExpiredReservations(100);
    const demo = demoMode() ? await resetDemoStore() : null;
    invalidateCatalog();
    invalidateShipping();
    return Response.json({ released, demo }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Daily job failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Daily job failed" }, { status: 500 });
  }
}
