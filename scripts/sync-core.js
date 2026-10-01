// Copies packages/core/*.js into apps/web/core so the static site can import it.
// Run before deploying: node scripts/sync-core.js  (npm run deploy does this).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packages", "core");
const dst = join(root, "apps", "web", "core");
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) if (f.endsWith(".js")) cpSync(join(src, f), join(dst, f));
console.log("core synced →", dst);
