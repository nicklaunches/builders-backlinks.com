import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { seedInbox } from "./seed";

loadEnv({ path: ".env.local", quiet: true });

/**
 * @file `pnpm seed:inbox` — fills a local database with an inbox worth opening.
 *
 * The seeding itself lives in `scripts/seed.ts`, because the smoke suite and the
 * browser suite call it directly rather than shelling out to this. All this adds
 * is the file on disk, which is there so a human can find the seeded thread ids
 * and sign-in cookies without re-running anything.
 */

const OUTPUT = path.join(".seed", "inbox.json");

async function main(): Promise<void> {
    const seed = await seedInbox();

    await mkdir(path.dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(seed, null, 4)}\n`);

    console.log(`Seeded ${Object.keys(seed.people).length} members and ${Object.keys(seed.matches).length} threads.`);
    console.log(`Wrote ${OUTPUT}`);
    console.log(`Agreed thread: /app/inbox/${seed.matches.agreed}`);
    process.exit(0);
}

void main().catch((err) => {
    console.error(err);
    process.exit(1);
});
