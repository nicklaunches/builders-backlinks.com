import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { brand, copy } from "./brand";
import { ensureFonts, esc, rasterise, report } from "./render";
import { monoWidth } from "./svg";

/**
 * @file Cards attached to a specific post on a specific day.
 *
 * Separate from `generate.ts` because the two have opposite lifecycles. Brand
 * assets are regenerated whenever the brand changes and the newest version is
 * the only one that matters. A post card is published once, at a date, against
 * numbers that were true that morning, and must never quietly change afterwards
 * because someone reran a script.
 *
 * That is why the data below is a literal rather than a call to the exchange:
 * rerunning this in a month has to produce the same pixels, not newer numbers
 * under an older claim.
 *
 * Run with `pnpm assets:post`.
 */

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/posts");

/**
 * Pulled from the `get_categories` MCP tool on the date below, alongside the
 * live founder count on the landing page. Post 359 in the marketing repo cites
 * these; `posted/2026-08-03.md` is the record of what was claimed.
 */
const SNAPSHOT = {
    date: "2026-08-03",
    /** Categories with nobody in them at all. The tool's "be first" list. */
    emptyCategories: 25,
    rows: [
        { label: "Launch Platforms", count: 6 },
        { label: "AI", count: 3 },
        { label: "Marketing", count: 3 },
        { label: "Finance", count: 2 },
        { label: "Lifestyle", count: 2 },
        { label: "SEO", count: 2 },
        { label: "Social Media", count: 2 },
        { label: "Developer Tools", count: 1 },
        { label: "Education", count: 1 },
        { label: "Food & Drink", count: 1 },
        { label: "No Code", count: 1 },
        { label: "Travel", count: 1 },
    ],
} as const;

/**
 * Pulled from the `get_categories` MCP tool on the date below.
 *
 * The headline this renders ("where the 56 sites are") counts sites, which is
 * what the tool returns and what the exchange trades. Post 471 leads on 58
 * builders, a larger number because a builder can register before a site is
 * active. `posted/2026-08-22.md` is the record of both.
 */
const SNAPSHOT_0822 = {
    date: "2026-08-22",
    /** Categories with nobody in them at all. The tool's "be first" list. */
    emptyCategories: 18,
    rows: [
        { label: "Launch Platforms", count: 8 },
        { label: "Marketing", count: 7 },
        { label: "Food & Drink", count: 6 },
        { label: "SEO", count: 5 },
        { label: "AI", count: 4 },
        { label: "Developer Tools", count: 4 },
        { label: "Finance", count: 3 },
        { label: "Lifestyle", count: 3 },
        { label: "Social Media", count: 3 },
        { label: "Design Tools", count: 2 },
        { label: "Education", count: 2 },
        { label: "Travel", count: 2 },
        { label: "Analytics", count: 1 },
        { label: "E-Commerce", count: 1 },
        { label: "Health & Fitness", count: 1 },
        { label: "Legal", count: 1 },
        { label: "Music", count: 1 },
        { label: "No Code", count: 1 },
        { label: "Productivity", count: 1 },
    ],
} as const;

/**
 * How many bars are drawn before the tail is rolled into one muted line.
 *
 * X renders an attached image at roughly 400px wide, so this card is read at a
 * quarter of its authored size. Twelve rows would put the labels near 8px.
 * Seven holds them at 18px, and the five single-site categories say nothing
 * individually that the rollup does not say once.
 */
const VISIBLE_ROWS = 7;

/**
 * Our own standing, pulled from `get_my_standing` on the date below.
 *
 * `was` is not a second reading. It is what post 360 published on 2026-08-03,
 * so the card states a change against a claim that is already public rather than
 * against a number only this repo has seen.
 */
const STANDING = {
    date: "2026-08-06",
    sites: 5,
    given: 1,
    received: 1,
    /** The product's own verdict, printed verbatim rather than re-derived here. */
    standing: "healthy",
    was: { given: 0, received: 0 },
    headline: "the first trade, closed both ways",
} as const;

/**
 * Our own standing, pulled from `get_my_standing` on the date below.
 *
 * `was` is the 08-06 card's figures, which is what post 360's family put in
 * public. The card states the move against a published claim, not against a
 * reading only this repo has seen.
 */
const STANDING_0822 = {
    date: "2026-08-22",
    sites: 5,
    given: 7,
    received: 7,
    /** The product's own verdict, printed verbatim rather than re-derived here. */
    standing: "healthy",
    was: { given: 1, received: 1 },
    headline: "seven trades, closed both ways",
} as const;

type Snapshot = {
    readonly date: string;
    readonly emptyCategories: number;
    readonly rows: readonly { readonly label: string; readonly count: number }[];
};

type Standing = {
    readonly date: string;
    readonly sites: number;
    readonly given: number;
    readonly received: number;
    readonly standing: string;
    readonly was: { readonly given: number; readonly received: number };
    readonly headline: string;
};

/** Measured as one glyph, emitted as ASCII. Both matter: see `valueRow`. */
const ARROW = "→";
const ARROW_ENTITY = "&#8594;";

/**
 * The category ladder.
 *
 * Same ground, frame, corner bug and wordmark as `flowSvg`, because it is the
 * same object seen in the same place: a rectangle in a feed.
 *
 * Nothing here is a tuned coordinate. The label gutter is measured off the
 * longest label actually drawn and every bar is measured off the largest count
 * actually present, so a re-pulled snapshot with different names and a
 * different maximum reflows instead of overlapping.
 */
export function categoryLadderSvg(snapshot: Snapshot): string {
    const width = 1600;
    const height = 900;
    const pad = 64;

    const markSize = 56;
    const headSize = 40;
    const labelSize = 32;
    const countSize = 32;
    const rollupSize = 30;
    const footSize = 34;
    const wordSize = 34;

    const rowsTop = 200;
    const rowHeight = 72;
    const barHeight = 34;
    const barRadius = 6;
    const labelGap = 24;
    const countGap = 16;
    /** Room for the count sitting past the end of the longest bar. */
    const countGutter = 90;

    const shown = snapshot.rows.slice(0, VISIBLE_ROWS);
    const rest = snapshot.rows.slice(VISIBLE_ROWS);

    // Derived, never restated: the headline cannot disagree with the bars.
    const totalSites = snapshot.rows.reduce((sum, r) => sum + r.count, 0);
    const maxCount = Math.max(...shown.map((r) => r.count));

    const gutter = Math.max(...shown.map((r) => monoWidth(r.label, labelSize)));
    const barX = pad + gutter + labelGap;
    const barMax = width - pad - barX - countGutter;

    const headY = pad + 42;
    // Wordmark left, payoff line right, on one shared baseline. Stacked, the two
    // collapse into a single block whatever the gap, because both are 34px and
    // both start at the same x. Split across the footer they stay distinct and
    // the empty right half of the card finally carries something.
    const footerY = height - pad;
    const rollupY = rowsTop + shown.length * rowHeight + 6;

    const footText = `${snapshot.emptyCategories} categories still have nobody in them`;
    const footX = width - pad - monoWidth(footText, footSize);

    const leftW = monoWidth("builders", wordSize);
    const slashW = monoWidth("/", wordSize);

    const bugX = width - pad - markSize;
    const bugY = pad;

    const bars = shown
        .map(({ label, count }, i) => {
            const rowY = rowsTop + i * rowHeight;
            const barW = (count / maxCount) * barMax;
            // Labels are right-aligned into the gutter so every bar starts at
            // the same x and the row lengths stay comparable at a glance.
            const labelX = pad + gutter - monoWidth(label, labelSize);
            const textY = rowY + labelSize * 0.35;

            return `<text x="${labelX}" y="${textY}" font-size="${labelSize}" font-weight="500" fill="${brand.fg}">${esc(label)}</text>
      <rect x="${barX}" y="${rowY - barHeight / 2}" width="${barW}" height="${barHeight}" rx="${barRadius}" fill="${brand.accent}"/>
      <text x="${barX + barW + countGap}" y="${textY}" font-size="${countSize}" font-weight="700" fill="${brand.fg}">${count}</text>`;
        })
        .join("\n      ");

    // The tail is currently five categories holding one site apiece, which reads
    // better as "one site each" than as a second number. Derived rather than
    // written, so a later snapshot with a 2 down there states the total instead
    // of quietly claiming something untrue.
    const restSites = rest.reduce((sum, r) => sum + r.count, 0);
    const rollupText =
        rest.length && rest.every((r) => r.count === 1)
            ? `+ ${rest.length} more with one site each`
            : `+ ${rest.length} more categories, ${restSites} sites`;

    const rollup = rest.length
        ? `<text x="${pad}" y="${rollupY}" font-size="${rollupSize}" font-weight="400" fill="${brand.muted}">${esc(rollupText)}</text>`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${brand.bg}"/>

  <!-- Hairline frame, echoing the bordered cards the site is built from. -->
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="10" fill="none" stroke="${brand.line}" stroke-width="2"/>

  <!-- The mark, as a bug in the top-right. Same geometry as the favicon. -->
  <line x1="${bugX + markSize * 0.2}" y1="${bugY + markSize * 0.82}" x2="${bugX + markSize * 0.8}" y2="${bugY + markSize * 0.18}" stroke="${brand.accent}" stroke-width="${Math.round(markSize * 0.14)}" stroke-linecap="square"/>

  <g font-family="JetBrains Mono, ui-monospace, monospace">
    <text x="${pad}" y="${headY}" font-size="${headSize}" font-weight="500" fill="${brand.fg}">where the ${totalSites} sites are</text>

    <g>
      ${bars}
    </g>

    ${rollup}

    <text x="${footX}" y="${footerY}" font-size="${footSize}" font-weight="500" fill="${brand.fg}">${esc(footText)}</text>

    <!-- Wordmark. Three runs, positioned by exact monospace advance. -->
    <g font-size="${wordSize}" font-weight="700">
      <text x="${pad}" y="${footerY}" fill="${brand.fg}">builders</text>
      <text x="${pad + leftW}" y="${footerY}" fill="${brand.accent}">/</text>
      <text x="${pad + leftW + slashW}" y="${footerY}" fill="${brand.fg}">backlinks</text>
    </g>
  </g>
</svg>`;
}

/**
 * Our link standing, as four rows.
 *
 * This exists because the alternative leaks. Post 360 shipped a terminal capture
 * of the agent listing matches, and it carried a masked partner's description,
 * their DR and five anchor targets out with it; `posted/2026-08-03.md` wrote the
 * rule afterwards as "crop to the standing lines and cut the partner block".
 *
 * A crop depends on remembering that every time. THIS CANNOT LEAK A PARTNER,
 * because `Standing` has no field that can hold one. That property is the reason
 * to prefer a generated card over a screenshot here, and it is worth more than
 * the typography.
 *
 * Same ground, frame, corner bug and wordmark as `categoryLadderSvg`: it is the
 * same object seen in the same place.
 */
export function standingSvg(snapshot: Standing): string {
    const width = 1600;
    const height = 900;
    const pad = 64;

    const markSize = 56;
    const headSize = 40;
    const labelSize = 40;
    const valueSize = 72;
    const wordSize = 34;

    const rowsTop = 310;
    const rowHeight = 124;
    const labelGap = 48;

    const rows = [
        { label: "sites", value: String(snapshot.sites) },
        { label: "given", value: String(snapshot.given), was: snapshot.was.given },
        { label: "received", value: String(snapshot.received), was: snapshot.was.received },
        { label: "standing", value: snapshot.standing },
    ];

    const gutter = Math.max(...rows.map((r) => monoWidth(r.label, labelSize)));
    const valueX = pad + gutter + labelGap;

    const headY = pad + 42;
    const footerY = height - pad;

    const leftW = monoWidth(copy.wordmarkLeft, wordSize);
    const slashW = monoWidth(copy.wordmarkSlash, wordSize);

    const bugX = width - pad - markSize;
    const bugY = pad;

    const body = rows
        .map(({ label, value, was }, i) => {
            const baseline = rowsTop + i * rowHeight;
            // Labels are right-aligned into the gutter so every value starts at
            // the same x, the same way the ladder aligns its bars.
            const labelX = pad + gutter - monoWidth(label, labelSize);

            // A row only carries its previous value when that value actually
            // moved. A later snapshot where nothing changed prints a bare
            // number rather than claiming "1 → 1", which would read as news.
            const changed = was !== undefined && String(was) !== value;
            // Measured with the trailing space, emitted without it: SVG collapses
            // trailing whitespace, so the gap has to come from the offset.
            const prefixX = changed ? monoWidth(`${was} ${ARROW} `, valueSize) : 0;
            const prefix = changed
                ? `<text x="${valueX}" y="${baseline}" font-size="${valueSize}" font-weight="500" fill="${brand.muted}">${was} ${ARROW_ENTITY}</text>`
                : "";

            return `<text x="${labelX}" y="${baseline}" font-size="${labelSize}" font-weight="500" fill="${brand.muted}">${esc(label)}</text>
      ${prefix}
      <text x="${valueX + prefixX}" y="${baseline}" font-size="${valueSize}" font-weight="700" fill="${brand.fg}">${esc(value)}</text>`;
        })
        .join("\n      ");

    const dateX = width - pad - monoWidth(snapshot.date, wordSize);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${brand.bg}"/>

  <!-- Hairline frame, echoing the bordered cards the site is built from. -->
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="10" fill="none" stroke="${brand.line}" stroke-width="2"/>

  <!-- The mark, as a bug in the top-right. Same geometry as the favicon. -->
  <line x1="${bugX + markSize * 0.2}" y1="${bugY + markSize * 0.82}" x2="${bugX + markSize * 0.8}" y2="${bugY + markSize * 0.18}" stroke="${brand.accent}" stroke-width="${Math.round(markSize * 0.14)}" stroke-linecap="square"/>

  <g font-family="JetBrains Mono, ui-monospace, monospace">
    <text x="${pad}" y="${headY}" font-size="${headSize}" font-weight="500" fill="${brand.fg}">${esc(snapshot.headline)}</text>

    <g>
      ${body}
    </g>

    <text x="${dateX}" y="${footerY}" font-size="${wordSize}" font-weight="500" fill="${brand.muted}">${esc(snapshot.date)}</text>

    <!-- Wordmark. Three runs, positioned by exact monospace advance. -->
    <g font-size="${wordSize}" font-weight="700">
      <text x="${pad}" y="${footerY}" fill="${brand.fg}">${copy.wordmarkLeft}</text>
      <text x="${pad + leftW}" y="${footerY}" fill="${brand.accent}">${copy.wordmarkSlash}</text>
      <text x="${pad + leftW + slashW}" y="${footerY}" fill="${brand.fg}">${copy.wordmarkRight}</text>
    </g>
  </g>
</svg>`;
}

/**
 * Every card ever published, not just the newest one.
 *
 * Each entry stays here after its post has run so that rerunning this script
 * reproduces the whole set byte for byte. Removing an entry is how a published
 * claim quietly loses its evidence.
 */
const CARDS: readonly { name: string; svg: string }[] = [
    { name: `${SNAPSHOT.date}-categories.png`, svg: categoryLadderSvg(SNAPSHOT) },
    { name: `${STANDING.date}-standing.png`, svg: standingSvg(STANDING) },
    { name: `${SNAPSHOT_0822.date}-categories.png`, svg: categoryLadderSvg(SNAPSHOT_0822) },
    { name: `${STANDING_0822.date}-standing.png`, svg: standingSvg(STANDING_0822) },
];

async function main() {
    console.log("Generating post cards\n");

    const fontFiles = await ensureFonts();
    await mkdir(OUT_DIR, { recursive: true });

    for (const card of CARDS) {
        const png = rasterise(card.svg, fontFiles, 1600);
        await writeFile(path.join(OUT_DIR, card.name), png);
        report(`public/posts/${card.name}`, png.length, "1600×900");
    }

    console.log("\nAttach it to the post by hand. Nothing serves these by convention.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
