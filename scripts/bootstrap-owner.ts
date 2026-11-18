import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { auth } from "../src/server/auth";
import { db, pool } from "../src/server/db";
import { auditEvent, user } from "../src/server/schema";

// Local preview only. Production owner provisioning must use verified identity.
async function main() {
try {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(databaseUrl.hostname) || databaseUrl.pathname !== "/cartiva") {
    throw new Error("This command only provisions the local Cartiva preview.");
  }
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.role, "owner")).limit(1);
  if (existing.length) {
    console.log("An owner already exists. No account or password changed.");
  } else {
    const email = "owner@cartiva.test";
    const password = randomBytes(24).toString("base64url");
    // Save recoverable credentials before creating an account. A stale file or
    // failed write must stop provisioning before any user receives owner access.
    await mkdir(".local", { recursive: true });
    await writeFile(".local/owner-access.txt", `Cartiva local preview only\nSign in: http://127.0.0.1:3000/sign-in\nEmail: ${email}\nPassword: ${password}\n\nGenerated locally. Do not publish or reuse these credentials.\n`, { flag: "wx" });
    const result = await auth.api.signUpEmail({ body: { name: "Cartiva local owner", email, password } });
    await db.transaction(async (tx) => {
      await tx.update(user).set({ role: "owner" }).where(eq(user.id, result.user.id));
      await tx.insert(auditEvent).values({ id: randomUUID(), actorId: "local-bootstrap", action: "owner.provisioned", subjectId: result.user.id });
    });
    console.log("Local owner created. Credentials saved in .local/owner-access.txt (excluded from version control).");
  }
} finally {
  await pool.end();
}
}
void main().catch(() => { console.error("Owner provisioning failed. Check the local database and whether the owner email or credential file already exists."); process.exitCode = 1; });
