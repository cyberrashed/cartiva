// Local browser QA only: runs `next dev` (or `next start`) against the isolated cartiva_test database.
// Values from .env.test.local are loaded first, so Next.js does not replace them with .env.local.
// The auth origin follows --hostname/--port, so QA can run on another port when 3000 is busy.
import { createRequire } from "node:module";

const argument = name => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const port = argument("--port");
if (port) process.env.BETTER_AUTH_URL = `http://${argument("--hostname") ?? "127.0.0.1"}:${port}`;
// `--demo` previews the public portfolio mode with the ignored .local/demo-preview.env.
const demo = process.argv.indexOf("--demo");
if (demo > 0) {
  process.argv.splice(demo, 1);
  process.loadEnvFile(".local/demo-preview.env");
}
process.loadEnvFile(".env.test.local");
if (!new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("/cartiva_test")) {
  throw new Error("dev-test-db requires DATABASE_URL to target cartiva_test.");
}
createRequire(import.meta.url)("../node_modules/next/dist/bin/next");
