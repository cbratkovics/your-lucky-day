// @ts-check
/**
 * Local dev server: `npm run dev` → http://localhost:8787
 * Serves apps/web statically and runs the real worker routes against a local
 * SQLite file (apps/worker/dev.sqlite) via the D1 shim. No wrangler needed.
 *
 * Env overrides: PORT, DAILY_SALT, UNLOCK_SECRET, POLAR_TOKEN, POLAR_PRODUCT_ID
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { D1Shim } from "./d1-shim.js";
import { route } from "./worker.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "web");
const PORT = Number(process.env.PORT || 8787);

const DB = new D1Shim(process.env.DEV_DB || join(here, "dev.sqlite"));
DB.exec(readFileSync(join(here, "schema.sql"), "utf8"));

const env = {
  DB,
  DAILY_SALT: process.env.DAILY_SALT || "dev-salt-change-me",
  UNLOCK_SECRET: process.env.UNLOCK_SECRET || "dev-unlock-change-me",
  POLAR_TOKEN: process.env.POLAR_TOKEN,
  POLAR_PRODUCT_ID: process.env.POLAR_PRODUCT_ID,
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(url, { method: req.method, headers: /** @type {any} */ (req.headers), body });
    const out = await route(request, url, env, Date.now());
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = normalize(join(webDir, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(webDir)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(webDir, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Your Lucky Day → http://localhost:${PORT}`));
