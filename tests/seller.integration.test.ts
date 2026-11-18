import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import type { AdminSellerApplicationDTO, SellerApplicationDTO, SellerApplicationFields } from "../src/lib/seller-application.ts";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Seller integration tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;

test("seller applications persist and enforce ownership, review permissions and atomic approval", { timeout: 60_000 }, async t => {
  // All server imports occur after the isolated-database guard.
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { GET: getOwn, POST: saveOwn } = await import("../src/app/api/seller-application/route.ts");
  const { GET: list } = await import("../src/app/api/admin/seller-applications/route.ts");
  const { POST: review } = await import("../src/app/api/admin/seller-applications/[id]/route.ts");
  const { GET: me } = await import("../src/app/api/me/route.ts");
  const { getOwnSellerStore } = await import("../src/server/seller-applications.ts");
  const { hasPermission } = await import("../src/lib/permissions.ts");
  const { emptySellerFields } = await import("../src/lib/seller-application.ts");
  const runId = randomUUID();
  const password = `Test-only-${randomUUID()}`;
  const fixtureEmails = ["first", "second", "admin", "privileged"].map(label => `seller-${runId}-${label}@example.test`);
  const fixtureIds: string[] = [];
  const applicationIds: string[] = [];
  const validFields: SellerApplicationFields = {
    storeName: "Northline Goods", contactName: "Jordan Miller", category: "Home & living",
    description: "Thoughtfully selected everyday home goods from independent American makers.",
    city: "Austin", state: "TX", website: "https://northline.example.test",
  };
  let first = { id: "", cookie: "" };
  let second = { id: "", cookie: "" };
  let admin = { id: "", cookie: "" };
  let privileged = { id: "", cookie: "" };
  let application: SellerApplicationDTO;
  let secondApplication: SellerApplicationDTO;
  const rollbackConstraint = `seller_test_${runId.replaceAll("-", "")}`;

  function request(path: string, cookie = "", body?: unknown, headers?: Record<string, string>) {
    return new Request(`${origin}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { origin, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  function save(cookie: string, body: unknown, headers?: Record<string, string>) {
    return saveOwn(request("/api/seller-application", cookie, body, headers));
  }
  function reviewRequest(cookie: string, id: string, body: unknown, headers?: Record<string, string>) {
    return review(request(`/api/admin/seller-applications/${id}`, cookie, body, headers), { params: Promise.resolve({ id }) });
  }
  async function saved(response: Response): Promise<SellerApplicationDTO> {
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    return (await response.json() as { application: SellerApplicationDTO }).application;
  }
  async function fixture(index: number) {
    const response = await auth.handler(request("/api/auth/sign-up/email", "", { name: `Seller fixture ${index}`, email: fixtureEmails[index], password }));
    assert.equal(response.status, 200);
    const { user } = await response.json() as { user: { id: string } };
    fixtureIds.push(user.id);
    const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    assert.ok(cookie);
    return { id: user.id, cookie };
  }

  try {
    await pool.query("DELETE FROM rate_limit");
    first = await fixture(0);
    second = await fixture(1);
    admin = await fixture(2);
    privileged = await fixture(3);
    await pool.query("UPDATE \"user\" SET role = 'administrator' WHERE id = $1", [admin.id]);
    await pool.query("UPDATE \"user\" SET role = 'manager' WHERE id = $1", [privileged.id]);

    await t.test("anonymous and non-reviewer accounts cannot access protected operations", async () => {
      assert.equal((await getOwn(request("/api/seller-application"))).status, 401);
      assert.equal((await save("", { action: "save", version: 0, fields: emptySellerFields })).status, 401);
      assert.equal((await list(request("/api/admin/seller-applications"))).status, 401);
      assert.equal((await list(request("/api/admin/seller-applications", first.cookie))).status, 403);
      assert.equal((await list(request("/api/admin/seller-applications", privileged.cookie))).status, 403);
      assert.equal((await reviewRequest("", "unknown", { action: "approve", version: 1, feedback: "" })).status, 401);
    });

    await t.test("partial drafts persist without creating a store or appearing in the review queue", async () => {
      application = await saved(await save(first.cookie, { action: "save", version: 0, fields: { ...emptySellerFields, storeName: "Northline" } }));
      applicationIds.push(application.id);
      assert.equal(application.status, "draft");
      assert.equal(application.version, 1);
      assert.equal(application.submittedAt, null);
      assert.equal(await getOwnSellerStore(first.id), null);
      const independent = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        const row = await independent.query("SELECT fields, version FROM seller_application WHERE user_id = $1", [first.id]);
        assert.equal(row.rows[0].fields.storeName, "Northline");
        assert.equal(row.rows[0].version, 1);
      } finally { await independent.end(); }
      const queue = await list(request("/api/admin/seller-applications", admin.cookie));
      assert.equal(queue.status, 200);
      assert.ok(!(await queue.json() as { applications: AdminSellerApplicationDTO[] }).applications.some(row => row.id === application.id));
    });

    await t.test("owner reads ignore forged IDs and application bodies cannot set identity, roles or status", async () => {
      const own = await getOwn(request(`/api/seller-application?userId=${first.id}`, second.cookie));
      assert.deepEqual(await own.json(), { application: null });
      const firstRead = await getOwn(request(`/api/seller-application?userId=${second.id}`, first.cookie));
      assert.equal((await firstRead.json() as { application: SellerApplicationDTO }).application.id, application.id);
      for (const forged of [{ userId: second.id }, { role: "owner" }, { status: "approved" }]) {
        assert.equal((await save(first.cookie, { action: "save", version: application.version, fields: validFields, ...forged })).status, 400);
      }
      assert.equal((await save(first.cookie, { action: "save", version: application.version, fields: { ...validFields, ownerId: second.id } })).status, 400);
      assert.equal((await pool.query("SELECT role FROM \"user\" WHERE id = $1", [first.id])).rows[0].role, "customer");
    });

    await t.test("mutations require the trusted origin, JSON, bounded bodies and valid submitted fields", async () => {
      const body = { action: "submit", version: application.version, fields: validFields };
      assert.equal((await save(first.cookie, body, { origin: "https://untrusted.example.test" })).status, 403);
      assert.equal((await save(first.cookie, body, { origin: "" })).status, 403);
      assert.equal((await save(first.cookie, body, { "content-type": "text/plain" })).status, 415);
      assert.equal((await save(first.cookie, { ...body, fields: { ...validFields, description: "x".repeat(17_000) } })).status, 413);
      assert.equal((await saveOwn(new Request(`${origin}/api/seller-application`, { method: "POST", headers: { origin, cookie: first.cookie, "content-type": "application/json" }, body: "{" }))).status, 400);
      for (const changes of [{ description: "short" }, { state: "XX" }, { category: "Other" }, { website: "http://insecure.example.test" }, { storeName: "" }]) {
        const response = await save(first.cookie, { ...body, fields: { ...validFields, ...changes } });
        assert.equal(response.status, 400);
        assert.ok((await response.json() as { fieldErrors: Record<string, string> }).fieldErrors[Object.keys(changes)[0]]);
      }
      assert.equal((await save(first.cookie, { action: "save", version: application.version, fields: { ...validFields, contactName: "a".repeat(81) } })).status, 400);
    });

    await t.test("stale and simultaneous draft saves cannot overwrite one another", async () => {
      assert.equal((await save(first.cookie, { action: "save", version: 0, fields: validFields })).status, 409);
      const responses = await Promise.all([
        save(first.cookie, { action: "save", version: application.version, fields: validFields }),
        save(first.cookie, { action: "save", version: application.version, fields: { ...validFields, storeName: "Concurrent draft" } }),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      application = await saved(responses.find(response => response.status === 200)!);
      assert.equal(application.version, 2);
      assert.equal((await pool.query("SELECT id FROM seller_application WHERE user_id = $1", [first.id])).rowCount, 1);
    });

    await t.test("submission enters the review queue without granting seller access and cannot be repeated", async () => {
      application = await saved(await save(first.cookie, { action: "submit", version: application.version, fields: validFields }));
      assert.equal(application.status, "submitted");
      assert.ok(application.submittedAt);
      assert.equal(await getOwnSellerStore(first.id), null);
      const account = await me(request("/api/me", first.cookie));
      const role = (await account.json() as { role: string }).role;
      assert.equal(role, "customer");
      assert.equal(hasPermission(role, "vendor:view"), false);
      assert.equal((await save(first.cookie, { action: "submit", version: application.version, fields: validFields })).status, 409);
      assert.equal((await save(first.cookie, { action: "save", version: application.version, fields: validFields })).status, 409);
      const queue = await list(request("/api/admin/seller-applications", admin.cookie));
      const row = (await queue.json() as { applications: AdminSellerApplicationDTO[] }).applications.find(row => row.id === application.id);
      assert.equal(row?.applicantEmail, fixtureEmails[0]);
      assert.equal(row?.applicantName, "Seller fixture 0");
    });

    await t.test("only owner/admin may review and review feedback/version/origin are enforced", async () => {
      const command = { action: "request_changes", version: application.version, feedback: "Please clarify the product sourcing process." };
      assert.equal((await reviewRequest(first.cookie, application.id, command)).status, 403);
      assert.equal((await reviewRequest(privileged.cookie, application.id, command)).status, 403);
      assert.equal((await reviewRequest(admin.cookie, application.id, command, { origin: "https://untrusted.example.test" })).status, 403);
      assert.equal((await reviewRequest(admin.cookie, application.id, { ...command, feedback: "Short" })).status, 400);
      assert.equal((await reviewRequest(admin.cookie, application.id, { ...command, version: application.version - 1 })).status, 409);
      assert.equal((await reviewRequest(admin.cookie, application.id, { ...command, role: "owner" })).status, 400);
      application = await saved(await reviewRequest(admin.cookie, application.id, command));
      assert.equal(application.status, "changes_requested");
      assert.equal(application.feedback, command.feedback);
      assert.ok(application.reviewedAt);
      assert.equal(await getOwnSellerStore(first.id), null);
      assert.equal((await reviewRequest(admin.cookie, application.id, { action: "approve", version: application.version, feedback: "" })).status, 409);
    });

    await t.test("requested changes can be saved and resubmitted by their applicant", async () => {
      application = await saved(await save(first.cookie, { action: "save", version: application.version, fields: { ...validFields, description: "Work in progress" } }));
      assert.equal(application.status, "changes_requested");
      assert.ok(application.feedback);
      application = await saved(await save(first.cookie, { action: "submit", version: application.version, fields: { ...validFields, description: `${validFields.description} All makers are verified before listing.` } }));
      assert.equal(application.status, "submitted");
    });

    await t.test("concurrent approvals create exactly one owned store, one approval audit and a fresh-session role", async () => {
      const command = { action: "approve", version: application.version, feedback: "Welcome to Cartiva." };
      const responses = await Promise.all([reviewRequest(admin.cookie, application.id, command), reviewRequest(admin.cookie, application.id, command)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      application = await saved(responses.find(response => response.status === 200)!);
      assert.equal(application.status, "approved");
      const stores = await pool.query("SELECT owner_id, application_id, name FROM seller_store WHERE owner_id = $1", [first.id]);
      assert.deepEqual(stores.rows, [{ owner_id: first.id, application_id: application.id, name: validFields.storeName }]);
      assert.equal((await pool.query("SELECT id FROM audit_event WHERE subject_id = $1 AND action = 'seller_application.approved'", [application.id])).rowCount, 1);
      const account = await me(request("/api/me", first.cookie));
      assert.equal((await account.json() as { role: string }).role, "vendor_owner");
      const store = await getOwnSellerStore(first.id);
      assert.equal(store?.ownerId, first.id);
      assert.equal(store?.country, "US");
      assert.equal(await getOwnSellerStore(second.id), null);
      assert.equal((await save(first.cookie, { action: "save", version: application.version, fields: validFields })).status, 403);
      assert.equal((await reviewRequest(admin.cookie, application.id, { ...command, version: application.version })).status, 409);
    });

    await t.test("privileged roles cannot create seller applications", async () => {
      for (const role of ["manager", "staff", "vendor_owner", "vendor_staff", "administrator", "owner"]) {
        await pool.query("UPDATE \"user\" SET role = $1 WHERE id = $2", [role, privileged.id]);
        assert.equal((await save(privileged.cookie, { action: "submit", version: 0, fields: validFields })).status, 403, role);
      }
      assert.equal((await pool.query("SELECT id FROM seller_application WHERE user_id = $1", [privileged.id])).rowCount, 0);
    });

    await t.test("reviewers cannot approve their own earlier customer application", async () => {
      secondApplication = await saved(await save(second.cookie, { action: "submit", version: 0, fields: { ...validFields, storeName: "Second store" } }));
      applicationIds.push(secondApplication.id);
      await pool.query("UPDATE \"user\" SET role = 'administrator' WHERE id = $1", [second.id]);
      assert.equal((await reviewRequest(second.cookie, secondApplication.id, { action: "approve", version: secondApplication.version, feedback: "" })).status, 403);
      assert.equal(await getOwnSellerStore(second.id), null);
      await pool.query("UPDATE \"user\" SET role = 'customer' WHERE id = $1", [second.id]);
    });

    await t.test("an audit failure rolls back application, store and role changes together", async () => {
      // This constraint targets only this isolated run's UUID; no production data is touched.
      assert.match(secondApplication.id, /^[a-f0-9-]{36}$/);
      await pool.query(`ALTER TABLE audit_event ADD CONSTRAINT "${rollbackConstraint}" CHECK (subject_id <> '${secondApplication.id}' OR action <> 'seller_application.approved') NOT VALID`);
      try {
        const response = await reviewRequest(admin.cookie, secondApplication.id, { action: "approve", version: secondApplication.version, feedback: "" });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "We could not complete this request. Please try again." });
        const row = await pool.query("SELECT status, version FROM seller_application WHERE id = $1", [secondApplication.id]);
        assert.deepEqual(row.rows[0], { status: "submitted", version: secondApplication.version });
        assert.equal(await getOwnSellerStore(second.id), null);
        assert.equal((await pool.query("SELECT role FROM \"user\" WHERE id = $1", [second.id])).rows[0].role, "customer");
      } finally { await pool.query(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS "${rollbackConstraint}"`); }
    });

    await t.test("approval preserves any independently granted privileged role", async () => {
      await pool.query("UPDATE \"user\" SET role = 'manager' WHERE id = $1", [second.id]);
      secondApplication = await saved(await reviewRequest(privileged.cookie, secondApplication.id, { action: "approve", version: secondApplication.version, feedback: "" }));
      assert.equal(secondApplication.status, "approved");
      assert.equal((await pool.query("SELECT role FROM \"user\" WHERE id = $1", [second.id])).rows[0].role, "manager");
      assert.equal((await getOwnSellerStore(second.id))?.applicationId, secondApplication.id);
      assert.notEqual((await getOwnSellerStore(second.id))?.id, (await getOwnSellerStore(first.id))?.id);
    });

    await t.test("expired sessions cannot read or change applications", async () => {
      await pool.query("UPDATE session SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1", [first.id]);
      const response = await getOwn(request("/api/seller-application", first.cookie));
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    });
  } finally {
    try {
      await pool.query(`ALTER TABLE audit_event DROP CONSTRAINT IF EXISTS "${rollbackConstraint}"`);
      await pool.query("DELETE FROM audit_event WHERE actor_id = ANY($1::text[]) OR subject_id = ANY($2::text[])", [fixtureIds, applicationIds]);
      await pool.query("DELETE FROM \"user\" WHERE email = ANY($1::text[])", [fixtureEmails]);
      await pool.query("DELETE FROM rate_limit");
    } finally { await pool.end(); }
  }
});
