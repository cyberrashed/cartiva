// Generates the random production secrets once, into the ignored .local folder.
// Nothing is printed; open the file and copy each value into Vercel's settings.
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

const file = ".local/production-secrets.env";
const content = [
  "# Copy each line into Vercel → Project → Settings → Environment Variables (Production).",
  "# Generated locally; never commit, share or paste these into chat.",
  `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
  `DEMO_PASSWORD=${randomBytes(24).toString("base64url")}`,
  `CRON_SECRET=${randomBytes(32).toString("hex")}`,
  "DEMO_MODE=true",
  "",
].join("\n");

await mkdir(".local", { recursive: true });
try {
  await writeFile(file, content, { flag: "wx" });
  console.log(`Created ${file}. Values were not printed.`);
} catch (error) {
  if (error.code === "EEXIST") console.log(`${file} already exists; kept unchanged.`);
  else throw error;
}
