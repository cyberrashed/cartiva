import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const password = randomBytes(24).toString("hex");
const secret = randomBytes(48).toString("base64url");
const base = `POSTGRES_PASSWORD=${password}\nBETTER_AUTH_SECRET=${secret}\nBETTER_AUTH_URL=http://127.0.0.1:3000\n`;
try {
  await writeFile(".env.local", `${base}DATABASE_URL=postgresql://cartiva:${password}@127.0.0.1:55432/cartiva\n`, { flag: "wx" });
  await writeFile(".env.test.local", `${base}DATABASE_URL=postgresql://cartiva:${password}@127.0.0.1:55432/cartiva_test\n`, { flag: "wx" });
  console.log("Created local and isolated test settings. Secrets were not printed.");
} catch (error) {
  if (error.code === "EEXIST") console.log("Existing settings kept. No credentials were replaced.");
  else throw error;
}
