import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "Set DATABASE_URL to the isolated cartiva_test database.");
assert.equal(new URL(databaseUrl).pathname, "/cartiva_test", "Identity integration tests may run only against cartiva_test.");
assert.ok(process.env.BETTER_AUTH_URL, "Set BETTER_AUTH_URL for handler requests.");
const origin = new URL(process.env.BETTER_AUTH_URL).origin;

type SessionBody = {
  user: { id: string; name: string; email: string; role: string; emailVerified: boolean };
  session: { id: string; userId: string };
};

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map(cookie => cookie.split(";", 1)[0]).join("; ");
}

test("identity persists and enforces session, role, origin and rate-limit boundaries", { timeout: 60_000 }, async t => {
  // Import server modules only after the database-name guard above has passed.
  const { auth } = await import("../src/server/auth.ts");
  const { pool } = await import("../src/server/db.ts");
  const { GET: getMyAccount } = await import("../src/app/api/me/route.ts");
  const runId = randomUUID();
  const emails = [`identity-${runId}@example.test`, `identity-${runId}-second@example.test`, `identity-${runId}-short@example.test`];
  const password = `Test-only-${randomUUID()}`;
  const createdIds = new Set<string>();
  let firstId = "";
  let secondId = "";
  let firstCookie = "";
  let secondCookie = "";
  let firstSessionId = "";

  function request(path: string, body?: Record<string, unknown>, cookie?: string, extraHeaders?: Record<string, string>) {
    const headers = new Headers({ origin, ...extraHeaders });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    return auth.handler(new Request(`${origin}/api/auth${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  }

  try {
    // This table belongs exclusively to the isolated integration database.
    await pool.query("DELETE FROM rate_limit");
    const signup = await request("/sign-up/email", { name: "Identity first", email: emails[0], password, role: "owner" });
    assert.equal(signup.status, 200, "Initial fixture signup must succeed.");
    const signupBody = await signup.json() as { user: SessionBody["user"] };
    firstId = signupBody.user.id;
    createdIds.add(firstId);

    await t.test("signup ignores a supplied owner role and stores a password hash", async () => {
      assert.equal(signupBody.user.role, "customer");
      assert.equal(signupBody.user.emailVerified, false);
      const users = await pool.query("SELECT role, email_verified FROM \"user\" WHERE id = $1", [firstId]);
      assert.equal(users.rows[0].role, "customer");
      assert.equal(users.rows[0].email_verified, false);
      const credentials = await pool.query("SELECT password FROM account WHERE user_id = $1 AND provider_id = 'credential'", [firstId]);
      assert.equal(credentials.rowCount, 1);
      const hash = credentials.rows[0].password;
      assert.ok(typeof hash === "string" && hash.length > 32 && hash !== password && !hash.includes(password));
    });

    await t.test("duplicate email cannot create another user and short passwords cannot register", async () => {
      const duplicate = await request("/sign-up/email", { name: "Duplicate", email: emails[0].toUpperCase(), password });
      assert.equal(duplicate.status, 422);
      const duplicateRows = await pool.query("SELECT id FROM \"user\" WHERE email = $1", [emails[0]]);
      assert.deepEqual(duplicateRows.rows.map(row => row.id), [firstId]);
      const short = await request("/sign-up/email", { name: "Short password", email: emails[2], password: "too-short" });
      assert.equal(short.status, 400);
      const invalidRows = await pool.query("SELECT id FROM \"user\" WHERE email = $1", [emails[2]]);
      assert.equal(invalidRows.rowCount, 0);
    });

    await t.test("anonymous session lookup and an incorrect password do not authenticate", async () => {
      const anonymous = await request("/get-session");
      assert.equal(anonymous.status, 200);
      assert.equal(await anonymous.json(), null);
      const wrong = await request("/sign-in/email", { email: emails[0], password: "Incorrect-password-123" });
      assert.equal(wrong.status, 401);
      assert.equal(cookieHeader(wrong), "");
    });

    const signin = await request("/sign-in/email", { email: emails[0], password });
    assert.equal(signin.status, 200, "Fixture sign-in must succeed.");
    firstCookie = cookieHeader(signin);
    assert.ok(firstCookie);
    const sessionResponse = await request("/get-session", undefined, firstCookie);
    assert.equal(sessionResponse.status, 200);
    const firstSession = await sessionResponse.json() as SessionBody;
    firstSessionId = firstSession.session.id;

    await t.test("the session cookie has browser protections and resolves to the persisted customer", async () => {
      const tokenCookie = signin.headers.getSetCookie().find(cookie => cookie.split("=", 1)[0].endsWith(".session_token"));
      assert.ok(tokenCookie);
      assert.ok(/;\s*httponly(?:;|$)/i.test(tokenCookie));
      assert.ok(/;\s*samesite=lax(?:;|$)/i.test(tokenCookie));
      if (origin.startsWith("https:")) assert.ok(/;\s*secure(?:;|$)/i.test(tokenCookie));
      assert.equal(firstSession.user.id, firstId);
      assert.equal(firstSession.user.role, "customer");
      assert.equal(firstSession.session.userId, firstId);
      const independentPool = new Pool({ connectionString: databaseUrl, max: 1 });
      try {
        const persisted = await independentPool.query("SELECT user_id FROM session WHERE id = $1 AND expires_at > NOW()", [firstSessionId]);
        assert.equal(persisted.rows[0]?.user_id, firstId);
      } finally {
        await independentPool.end();
      }
    });

    await t.test("a second customer receives a distinct identity and session", async () => {
      const secondSignup = await request("/sign-up/email", { name: "Identity second", email: emails[1], password });
      assert.equal(secondSignup.status, 200);
      const secondBody = await secondSignup.json() as { user: SessionBody["user"] };
      secondId = secondBody.user.id;
      createdIds.add(secondId);
      const secondSignin = await request("/sign-in/email", { email: emails[1], password });
      assert.equal(secondSignin.status, 200);
      secondCookie = cookieHeader(secondSignin);
      const response = await request("/get-session", undefined, secondCookie);
      const session = await response.json() as SessionBody;
      assert.equal(session.user.id, secondId);
      assert.notEqual(session.user.id, firstId);
      assert.notEqual(session.session.id, firstSessionId);
    });

    await t.test("profile updates cannot elevate roles or target another customer", async () => {
      const elevated = await request("/update-user", { name: "Attempted owner", role: "owner" }, firstCookie);
      assert.equal(elevated.status, 400);
      const update = await request("/update-user", { name: "Identity updated", id: secondId }, firstCookie);
      assert.equal(update.status, 200);
      const first = await pool.query("SELECT name, role FROM \"user\" WHERE id = $1", [firstId]);
      const second = await pool.query("SELECT name, role FROM \"user\" WHERE id = $1", [secondId]);
      assert.deepEqual(first.rows[0], { name: "Identity updated", role: "customer" });
      assert.deepEqual(second.rows[0], { name: "Identity second", role: "customer" });
    });

    await t.test("the account endpoint requires a session and ignores another customer's ID", async () => {
      const anonymous = await getMyAccount(new Request(`${origin}/api/me?userId=${secondId}`));
      assert.equal(anonymous.status, 401);
      assert.equal(anonymous.headers.get("cache-control"), "private, no-store");
      const response = await getMyAccount(new Request(`${origin}/api/me?userId=${secondId}`, { headers: { cookie: firstCookie } }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), { id: firstId, name: "Identity updated", email: emails[0], role: "customer" });
    });

    await t.test("existing sessions read role changes from the database", async () => {
      await pool.query("UPDATE \"user\" SET role = 'staff' WHERE id = $1", [firstId]);
      const changed = await request("/get-session", undefined, firstCookie);
      assert.equal((await changed.json() as SessionBody).user.role, "staff");
      await pool.query("UPDATE \"user\" SET role = 'customer' WHERE id = $1", [firstId]);
      const restored = await request("/get-session", undefined, firstCookie);
      assert.equal((await restored.json() as SessionBody).user.role, "customer");
    });

    await t.test("an untrusted origin cannot mutate an authenticated account", async () => {
      const response = await request("/update-user", { name: "Cross-origin change" }, firstCookie, { origin: "https://untrusted.example.test" });
      assert.equal(response.status, 403);
      const row = await pool.query("SELECT name FROM \"user\" WHERE id = $1", [firstId]);
      assert.equal(row.rows[0].name, "Identity updated");
    });

    await t.test("the other local name for the same port is trusted, another port is not", async (sub) => {
      const configured = new URL(origin);
      if (!["127.0.0.1", "localhost"].includes(configured.hostname)) return sub.skip("BETTER_AUTH_URL is not a local address");
      const alias = `${configured.protocol}//${configured.hostname === "localhost" ? "127.0.0.1" : "localhost"}:${configured.port}`;
      const otherPort = `${configured.protocol}//${configured.hostname}:${Number(configured.port || 80) + 1}`;
      const rejected = await request("/update-user", { name: "Other port change" }, firstCookie, { origin: otherPort });
      assert.equal(rejected.status, 403);
      const accepted = await request("/update-user", { name: "Identity updated" }, firstCookie, { origin: alias });
      assert.equal(accepted.status, 200);
    });

    await t.test("sign-out revokes the saved session and replaying its cookie cannot authenticate", async () => {
      const response = await request("/sign-out", {}, firstCookie);
      assert.equal(response.status, 200);
      const persisted = await pool.query("SELECT id FROM session WHERE id = $1", [firstSessionId]);
      assert.equal(persisted.rowCount, 0);
      const replay = await request("/get-session", undefined, firstCookie);
      assert.equal(await replay.json(), null);
      const other = await request("/get-session", undefined, secondCookie);
      assert.equal((await other.json() as SessionBody).user.id, secondId);
    });

    await t.test("expired sessions cannot authenticate", async () => {
      await pool.query("UPDATE session SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1", [secondId]);
      const expired = await request("/get-session", undefined, secondCookie);
      assert.equal(await expired.json(), null);
    });

    await t.test("database rate limits block repeated sign-in despite spoofed forwarding headers", async () => {
      await pool.query("DELETE FROM rate_limit");
      for (let attempt = 1; attempt <= 11; attempt++) {
        const response = await request("/sign-in/email", { email: emails[0], password: "Incorrect-password-123" }, undefined, { "x-forwarded-for": `198.51.100.${attempt}` });
        assert.equal(response.status, attempt <= 10 ? 401 : 429, `Sign-in attempt ${attempt}`);
        if (attempt === 11) assert.ok(Number(response.headers.get("x-retry-after")) > 0);
      }
      const buckets = await pool.query("SELECT count, last_request FROM rate_limit");
      assert.equal(buckets.rowCount, 1);
      assert.equal(buckets.rows[0].count, 10);
      assert.ok(Number(buckets.rows[0].last_request) > 0);
    });
  } finally {
    try {
      // Recover IDs even if a response/assertion failed after a fixture was inserted.
      const fixtures = await pool.query("SELECT id FROM \"user\" WHERE email = ANY($1::text[])", [emails]);
      for (const row of fixtures.rows) createdIds.add(row.id);
      if (createdIds.size) await pool.query("DELETE FROM \"user\" WHERE id = ANY($1::text[])", [[...createdIds]]);
      await pool.query("DELETE FROM rate_limit");
    } finally {
      await pool.end();
    }
  }
});
