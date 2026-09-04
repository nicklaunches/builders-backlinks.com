import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { seedInbox } from "../scripts/seed";

/**
 * @file Lays down the fixtures once, before any spec runs.
 *
 * Writes them where `fixtures.ts` reads them, rather than passing them through
 * Playwright's config: a global setup and a test file are different processes,
 * so a module-level export would be re-evaluated per worker and re-seed the
 * database underneath a running spec.
 */

export const SEED_FILE = path.join(".seed", "inbox.json");

export default async function globalSetup(): Promise<void> {
    const seed = await seedInbox();
    await mkdir(path.dirname(SEED_FILE), { recursive: true });
    await writeFile(SEED_FILE, `${JSON.stringify(seed, null, 4)}\n`);
}
