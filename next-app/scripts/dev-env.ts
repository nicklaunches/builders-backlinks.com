import { config as loadEnv } from "dotenv";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * @file `next dev` against an env file other than `.env.local`.
 *
 * Next always loads `.env.local`, and this machine's `.env.local` is
 * production. Every script and config here takes `ENV_FILE`; Next does not,
 * which is what this closes: the file is loaded into THIS process, and the dev
 * server inherits it as an ordinary environment. Next skips any variable
 * already set, so what is loaded here wins over what it would read.
 *
 * `--env-file` cannot do this. Next copies the parent's execArgv into
 * NODE_OPTIONS for the server it spawns, and node refuses `--env-file` there.
 *
 * Usage, from the suites' point of view:
 *
 *   ENV_FILE=.env.e2e pnpm dev:env --port 3100
 *
 * Arguments after the script name are passed to `next dev` untouched.
 */

loadEnv({ path: process.env.ENV_FILE ?? ".env.local", quiet: true });

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [next, "dev", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
});

child.on("exit", (code, signal) => {
    // Relay the child's fate rather than always exiting 0: a supervisor, and
    // Playwright's webServer, read this.
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
});
