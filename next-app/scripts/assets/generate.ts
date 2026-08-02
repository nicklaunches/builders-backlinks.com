import { Resvg } from "@resvg/resvg-js";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { sizes } from "./brand";
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
 * Fonts are fetched once into `.fonts/` beside this file (gitignored) rather
 * than vendored, because the typeface is JetBrains Mono under the OFL and a
 * binary in the repo is a licence obligation nobody remembers. Rasterisation
 * passes those files explicitly with `loadSystemFonts: false`, so output is
 * byte-identical everywhere instead of picking up whatever the host has
 * installed. Delete `.fonts/` to force a re-fetch.
 *
 * Run with `pnpm assets:generate`. Exits non-zero if anything fails.
 */

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src/app");
const PUBLIC_DIR = path.join(ROOT, "public");
const FONT_DIR = path.join(ROOT, "scripts/assets/.fonts");

/**
 * Static, versioned URLs. Pinned to a release tag rather than `main` so a
 * regenerate a year from now produces the same pixels as today.
 */
const FONTS: readonly { file: string; url: string }[] = [
    {
        file: "JetBrainsMono-Bold.ttf",
        url: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Bold.ttf",
    },
    {
        file: "JetBrainsMono-SemiBold.ttf",
        url: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-SemiBold.ttf",
    },
    {
        file: "JetBrainsMono-Medium.ttf",
        url: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Medium.ttf",
    },
    {
        file: "JetBrainsMono-Regular.ttf",
        url: "https://raw.githubusercontent.com/JetBrains/JetBrainsMono/v2.304/fonts/ttf/JetBrainsMono-Regular.ttf",
    },
];

/** Downloads the typeface once. Later runs are offline. */
async function ensureFonts(): Promise<string[]> {
    await mkdir(FONT_DIR, { recursive: true });
    const present = new Set(await readdir(FONT_DIR).catch(() => []));

    for (const font of FONTS) {
        if (present.has(font.file)) continue;
        process.stdout.write(`  fetching ${font.file} ... `);
        const response = await fetch(font.url);
        if (!response.ok) {
            throw new Error(`Could not download ${font.file}: ${response.status} ${response.statusText}`);
        }
        await writeFile(path.join(FONT_DIR, font.file), Buffer.from(await response.arrayBuffer()));
        console.log("ok");
    }

    return FONTS.map((f) => path.join(FONT_DIR, f.file));
}

/**
 * SVG to PNG, with fonts supplied explicitly.
 *
 * `loadSystemFonts: false` is the whole point. With it on, a machine missing
 * JetBrains Mono silently substitutes something else and the committed asset
 * changes depending on who ran the script.
 */
function rasterise(svg: string, fontFiles: string[], width: number): Buffer {
    const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: width },
        font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "JetBrains Mono" },
    });
    return Buffer.from(resvg.render().asPng());
}

/** One aligned line per artifact, matching the shape of `render-emails.ts`. */
function report(label: string, bytes: number, dimensions: string): void {
    const kb = (bytes / 1024).toFixed(1);
    console.log(`  ok    ${label.padEnd(34)}${dimensions.padEnd(12)}${kb} kB`);
}

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
