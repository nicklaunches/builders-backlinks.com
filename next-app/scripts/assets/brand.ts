/**
 * @file The brand, as data. Single source for every generated asset.
 *
 * Copied from the light theme in `src/app/globals.css`, the same way
 * `src/emails/_layout.tsx` copies it, and for the same reason: a Node script
 * cannot read CSS custom properties, and importing the stylesheet to parse it
 * would be worse than restating twelve hex values. If `globals.css` changes,
 * change these, then rerun `pnpm assets:generate`.
 *
 * THE ACCENT RULE decides every design choice in these files. `#ff7a05` is
 * 2.52:1 against the light ground and 7.54:1 against the dark one, so it is
 * legible as text only on dark. That is why the icon and the OG card are both
 * dark: it is the one ground where the brand colour can carry the mark itself
 * rather than being reduced to a fill behind near-black text.
 */

export const brand = {
    /** Dark ground. `--bg` from the dark theme. */
    bg: "#0a0b0d",
    /** One step up, for the card inside the OG frame. `--surface` dark. */
    surface: "#101216",
    /** Hairline. `--line` dark. */
    line: "#23262c",
    /** Body text on the dark ground. `--fg` dark. */
    fg: "#e9ebee",
    /** Secondary text. `--muted` dark. */
    muted: "#98a0ab",
    /** The brand fill. Never a text colour on light. */
    accent: "#ff7a05",
    /** What sits ON the accent fill. Near-black, never white. 7.09:1. */
    accentFg: "#1a1206",
} as const;

/** Canonical sizes. Apple wants 180; 512 covers every other icon slot. */
export const sizes = {
    icon: 512,
    appleIcon: 180,
    og: { width: 1200, height: 630 },
    /** 16:9 rather than the OG card's 1.91:1, because this one is attached to a
     *  post rather than unfurled from a link, and X gives an attached image the
     *  taller crop. Oversized at 1600 so it stays sharp on a retina timeline. */
    flow: { width: 1600, height: 900 },
} as const;

export const copy = {
    wordmarkLeft: "builders",
    wordmarkSlash: "/",
    wordmarkRight: "backlinks",
    tagline: "Trade backlinks from inside your coding agent",
    footnote: "An MCP server. Your agent writes the link, in your own words.",
    /**
     * The four steps, in order, for the how-it-works diagram.
     *
     * Here rather than inside the SVG builder for the same reason the tagline
     * is: this is the product's pitch, it will be reworded far more often than
     * the geometry around it will change, and someone editing the words should
     * not have to read a layout function to find them. The builder measures
     * whatever it is given, so a longer caption reflows instead of breaking.
     */
    flow: [
        { label: "connect", caption: "MCP server" },
        { label: "submit", caption: "your site" },
        { label: "match", caption: "one real builder" },
        { label: "place", caption: "agent writes it in your repo" },
    ],
} as const;
