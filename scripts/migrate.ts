import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/server/db";

async function main() {
try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Cartiva migrations applied.");
} finally {
  await pool.end();
}
}
void main().catch(() => { console.error("Migration failed. Check database availability and migration compatibility."); process.exitCode = 1; });
