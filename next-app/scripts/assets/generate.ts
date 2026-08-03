import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sizes } from "./brand";
import { ensureFonts, rasterise, report } from "./render";
import { flowSvg, iconSvg, logoSvg, ogSvg } from "./svg";

/**
 * @file Generates every brand asset from code. No source images, no design file.
 *
 * The site had no favicon and no OG image at all, while `layout.tsx` declared
 * `twitter.card: "summary_large_image"` with nothing behind it, so every share
 * rendered as a bare text card.
 *
 * This is a HAND-RUN TOOL, not a build step. Output is committed, so CI never
 * needs a network or a font. Run it when the brand changes, look at what it
 * produced, commit it.
 *
 * Fonts and rasterisation live in `render.ts`, shared with `post-card.ts`.
 * Delete `.fonts/` to force a re-fetch.
 *
 * Run with `pnpm assets:generate`. Exits non-zero if anything fails.
 */

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src/app");
const PUBLIC_DIR = path.join(ROOT, "public");

async function main() {
    console.log("Generating brand assets\n");

    const fontFiles = await ensureFonts();

    // Never rm() these directories. `public/` is tracked and holds
    // founders/nicklaunches.png; src/app/ is the application.
    await mkdir(APP_DIR, { recursive: true });
    await mkdir(PUBLIC_DIR, { recursive: true });

    // Icons. Pure geometry, so the fonts are irrelevant to them.
    const icon = rasterise(iconSvg(sizes.icon), fontFiles, sizes.icon);
    await writeFile(path.join(APP_DIR, "icon.png"), icon);
    report("src/app/icon.png", icon.length, `${sizes.icon}²`);

    const apple = rasterise(iconSvg(sizes.appleIcon), fontFiles, sizes.appleIcon);
    await writeFile(path.join(APP_DIR, "apple-icon.png"), apple);
    report("src/app/apple-icon.png", apple.length, `${sizes.appleIcon}²`);

    // The share card. This one genuinely needs the typeface.
    const og = rasterise(ogSvg(), fontFiles, sizes.og.width);
    await writeFile(path.join(APP_DIR, "opengraph-image.png"), og);
    report("src/app/opengraph-image.png", og.length, `${sizes.og.width}×${sizes.og.height}`);

    // The how-it-works diagram. Not a Next.js file convention: this one is
    // attached to a post by hand, so it lives in public/ and is linked to.
    const flow = rasterise(flowSvg(), fontFiles, sizes.flow.width);
    await writeFile(path.join(PUBLIC_DIR, "how-it-works.png"), flow);
    report("public/how-it-works.png", flow.length, `${sizes.flow.width}×${sizes.flow.height}`);

    // Vector wordmark, for the README and anywhere needing to scale.
    const logo = logoSvg();
    await writeFile(path.join(PUBLIC_DIR, "logo.svg"), logo, "utf8");
    report("public/logo.svg", Buffer.byteLength(logo), "vector");

    console.log("\nNext.js serves icon.png, apple-icon.png and opengraph-image.png");
    console.log("from src/app by file convention. Commit them: CI does not run this.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
