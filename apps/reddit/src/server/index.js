// Your Lucky Day — Devvit Web server entry.
// Bundled to a single CommonJS file by esbuild (see package.json build:server).
import { createServer, getServerPort } from "@devvit/web/server";
import { onRequest } from "./routes.js";

const server = createServer(onRequest);
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort(), () => console.log("your-lucky-day server up"));
