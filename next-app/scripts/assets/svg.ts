import { brand, copy, sizes } from "./brand";

/**
 * @file The assets themselves, as SVG source strings.
 *
 * Hand-authored rather than composed with satori, because the wordmark is
 * MONOSPACE. In JetBrains Mono every glyph advances exactly 0.6em, so the width
 * of a run of text is `chars * 0.6 * fontSize` and the layout can be computed
 * here to the pixel. That removes the entire reason people reach for a layout
 * engine, and with it a dependency, a JSX runtime in a build script, and a
 * class of "why is it two pixels off" problems.
 *
 * Nothing here reads a system font. `rasterise()` passes explicit font files
 * with `loadSystemFonts: false`, so the output is identical on a laptop and on
 * CI rather than silently substituting whatever DejaVu happens to be installed.
 */

/** JetBrains Mono advance width, in ems. Every glyph, by definition of monospace. */
const ADVANCE = 0.6;

/** Width in px of `text` set at `fontSize`. Exact, not estimated. */
export function monoWidth(text: string, fontSize: number): number {
    return text.length * ADVANCE * fontSize;
}

/**
 * The mark: the wordmark's slash, alone.
 *
 * The brand's only graphical element is the orange `/` between the two words,
 * so that is the mark. Drawn as a POLYGON rather than a glyph, which means the
 * icon needs no font at all and cannot shift if the typeface is ever swapped.
 *
 * The slash is inset and given a squared-off cap so it reads as deliberate at
 * 16px, where a hairline diagonal would disappear into grey.
 */
export function iconSvg(size: number): string {
    const r = Math.round(size * 0.22); // corner radius, roughly iOS squircle
    // Slash geometry, as fractions of the canvas: bottom-left to top-right.
    const x1 = size * 0.34;
    const y1 = size * 0.74;
    const x2 = size * 0.66;
    const y2 = size * 0.26;
    const stroke = Math.round(size * 0.115);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${brand.bg}"/>
  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${brand.accent}" stroke-width="${stroke}" stroke-linecap="square"/>
</svg>`;
}

/**
 * The scalable wordmark, for the README and anywhere needing vector.
 *
 * Text stays as `<text>` here rather than being converted to paths: this file
 * is for humans and GitHub, both of which have fonts, and keeping it as text
 * means the mark is greppable and editable. The rasterised assets do not use
 * this, so a missing typeface degrades to a fallback mono rather than breaking
 * anything that ships.
 */
export function logoSvg(): string {
    const fontSize = 48;
    const pad = 24;
    const text = copy.wordmarkLeft + copy.wordmarkSlash + copy.wordmarkRight;
    const width = Math.ceil(monoWidth(text, fontSize)) + pad * 2;
    const height = Math.ceil(fontSize * 1.6);
    const baseline = Math.round(height * 0.66);
    const leftW = monoWidth(copy.wordmarkLeft, fontSize);
    const slashW = monoWidth(copy.wordmarkSlash, fontSize);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="builders/backlinks">
  <rect width="${width}" height="${height}" fill="${brand.bg}"/>
  <g font-family="JetBrains Mono, ui-monospace, monospace" font-size="${fontSize}" font-weight="600" letter-spacing="-0.5">
    <text x="${pad}" y="${baseline}" fill="${brand.fg}">${copy.wordmarkLeft}</text>
    <text x="${pad + leftW}" y="${baseline}" fill="${brand.accent}">${copy.wordmarkSlash}</text>
    <text x="${pad + leftW + slashW}" y="${baseline}" fill="${brand.fg}">${copy.wordmarkRight}</text>
  </g>
</svg>`;
}

/**
 * The share card.
 *
 * Sits on the dark ground so the accent can be the accent. On light it would be
 * 2.52:1 and the slash, which is the entire mark, would wash out at the size a
 * timeline thumbnail renders.
 *
 * Laid out from the left rather than centred: the card is most often seen as a
 * small rectangle in a feed, and left-aligned text at a known x survives being
 * scaled down better than a centred block whose optical centre shifts with the
 * string length.
 */
export function ogSvg(): string {
    const { width, height } = sizes.og;
    const pad = 88;

    const markSize = 56;
    const wordSize = 62;
    const taglineSize = 34;
    const footSize = 22;

    const leftW = monoWidth(copy.wordmarkLeft, wordSize);
    const slashW = monoWidth(copy.wordmarkSlash, wordSize);

    const markY = pad + markSize;
    const wordY = markY + 150;
    const taglineY = wordY + 96;
    const footY = height - pad;

    // The mark, repeated small in the corner as a bug.
    const bugX = width - pad - markSize;
    const bugY = pad;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${brand.bg}"/>

  <!-- Hairline frame, echoing the bordered cards the site is built from. -->
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="10" fill="none" stroke="${brand.line}" stroke-width="2"/>

  <!-- The mark, as a bug in the top-right. Same geometry as the favicon. -->
  <line x1="${bugX + markSize * 0.2}" y1="${bugY + markSize * 0.82}" x2="${bugX + markSize * 0.8}" y2="${bugY + markSize * 0.18}" stroke="${brand.accent}" stroke-width="${Math.round(markSize * 0.14)}" stroke-linecap="square"/>

  <g font-family="JetBrains Mono, ui-monospace, monospace">
    <!-- Wordmark. Three runs, positioned by exact monospace advance. -->
    <g font-size="${wordSize}" font-weight="700" letter-spacing="-1">
      <text x="${pad}" y="${wordY}" fill="${brand.fg}">${copy.wordmarkLeft}</text>
      <text x="${pad + leftW}" y="${wordY}" fill="${brand.accent}">${copy.wordmarkSlash}</text>
      <text x="${pad + leftW + slashW}" y="${wordY}" fill="${brand.fg}">${copy.wordmarkRight}</text>
    </g>

    <text x="${pad}" y="${taglineY}" font-size="${taglineSize}" font-weight="500" fill="${brand.fg}">${copy.tagline}</text>

    <text x="${pad}" y="${footY}" font-size="${footSize}" font-weight="400" fill="${brand.muted}">${copy.footnote}</text>
  </g>
</svg>`;
}
