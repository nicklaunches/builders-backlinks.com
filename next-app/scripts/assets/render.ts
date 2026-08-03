import { Resvg } from "@resvg/resvg-js";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * @file The rasteriser, shared by every script that turns an SVG string into a
 * committed PNG.
 *
 * Split out of `generate.ts` when `post-card.ts` arrived: both need the same
 * typeface on disk and the same resvg configuration, and `loadSystemFonts:
 * false` only guarantees identical output everywhere if there is exactly one
 * place that sets it.
 */

const FONT_DIR = path.join(process.cwd(), "scripts/assets/.fonts");

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
export async function ensureFonts(): Promise<string[]> {
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
export function rasterise(svg: string, fontFiles: string[], width: number): Buffer {
    const resvg = new Resvg(svg, {
        fitTo: { mode: "width", value: width },
        font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "JetBrains Mono" },
    });
    return Buffer.from(resvg.render().asPng());
}

/** One aligned line per artifact, matching the shape of `render-emails.ts`. */
export function report(label: string, bytes: number, dimensions: string): void {
    const kb = (bytes / 1024).toFixed(1);
    console.log(`  ok    ${label.padEnd(34)}${dimensions.padEnd(12)}${kb} kB`);
}

/** Escapes the five XML entities. Category names carry `&`; brand strings do not. */
export function esc(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
