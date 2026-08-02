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
 * Greedy word wrap, measured with `monoWidth` rather than guessed at a character
 * count. Only the diagram needs it: one of its captions is wider than the box it
 * sits under, and the break belongs here, with the layout, rather than being
 * baked into `brand.ts` as a newline someone would have to preserve while
 * rewording.
 */
function wrapMono(text: string, fontSize: number, maxWidth: number): string[] {
    const lines: string[] = [];
    let line = "";

    for (const word of text.split(" ")) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && monoWidth(candidate, fontSize) > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line) lines.push(line);

    return lines;
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

/**
 * The how-it-works diagram, for attaching to a post.
 *
 * Same dark ground, same hairline frame, same corner bug as the share card,
 * because it is the same object seen in the same place: a rectangle in a feed.
 *
 * THE ONE NUMBER THAT MATTERS IS 4. X renders an attached image at roughly
 * 400px wide in-feed, so everything here is read at a quarter of its authored
 * size. The 64px step labels survive that as 16px; the captions are deliberately
 * secondary and are allowed to fall below it, since a reader who has stopped to
 * squint at them has already stopped scrolling.
 *
 * The row is measured, not tuned. Each box is sized to its own label, and the
 * leftover width is divided evenly into the three gaps, so the steps always span
 * the frame exactly and the arrows always land in the space between two boxes
 * however the copy in `brand.ts` is reworded.
 */
export function flowSvg(): string {
    const { width, height } = sizes.flow;
    const pad = 64;

    const markSize = 56;
    const headSize = 40;
    const labelSize = 64;
    const captionSize = 30;
    const wordSize = 34;

    const boxPadX = 40;
    // 16:9 leaves a single row of boxes floating in a lot of air. The box is
    // made tall enough, and sat high enough, that the space above the row and
    // the space below the captions come out roughly equal.
    const boxHeight = 190;
    const boxTop = 315;
    const boxRadius = 14;

    // Captions are centred under their box and may overhang it, so the cap is on
    // the caption itself: two adjacent captions at this width cannot meet, and
    // the last one cannot reach the frame.
    const captionMax = 300;
    const captionLead = 38;

    const arrowInset = 16;
    const arrowHead = 18;

    // Size every box to its own label, then split what is left into the gaps.
    const boxes = copy.flow.map((step) => ({
        step,
        boxWidth: monoWidth(step.label, labelSize) + boxPadX * 2,
    }));
    const rowWidth = boxes.reduce((sum, b) => sum + b.boxWidth, 0);
    const gap = (width - pad * 2 - rowWidth) / (boxes.length - 1);

    let cursor = pad;
    const placed = boxes.map((box) => {
        const x = cursor;
        cursor += box.boxWidth + gap;
        return { ...box, x };
    });

    const labelY = boxTop + boxHeight / 2 + labelSize * 0.35;
    const captionY = boxTop + boxHeight + 56;
    const arrowY = boxTop + boxHeight / 2;

    const headY = pad + 42;
    const wordY = height - pad;
    const leftW = monoWidth(copy.wordmarkLeft, wordSize);
    const slashW = monoWidth(copy.wordmarkSlash, wordSize);

    const bugX = width - pad - markSize;
    const bugY = pad;

    const cells = placed
        .map(({ step, boxWidth, x }) => {
            const labelX = x + (boxWidth - monoWidth(step.label, labelSize)) / 2;
            const centre = x + boxWidth / 2;
            const caption = wrapMono(step.caption, captionSize, captionMax)
                .map(
                    (line, i) =>
                        `<text x="${centre - monoWidth(line, captionSize) / 2}" y="${captionY + i * captionLead}" font-size="${captionSize}" font-weight="400" fill="${brand.muted}">${line}</text>`,
                )
                .join("\n      ");

            return `<rect x="${x}" y="${boxTop}" width="${boxWidth}" height="${boxHeight}" rx="${boxRadius}" fill="${brand.surface}" stroke="${brand.line}" stroke-width="2"/>
      <text x="${labelX}" y="${labelY}" font-size="${labelSize}" font-weight="700" fill="${brand.fg}">${step.label}</text>
      ${caption}`;
        })
        .join("\n      ");

    const arrows = placed
        .slice(0, -1)
        .map(({ boxWidth, x }) => {
            const from = x + boxWidth + arrowInset;
            const to = x + boxWidth + gap - arrowInset;
            return `<line x1="${from}" y1="${arrowY}" x2="${to - arrowHead}" y2="${arrowY}" stroke="${brand.accent}" stroke-width="5" stroke-linecap="round"/>
    <polygon points="${to},${arrowY} ${to - arrowHead},${arrowY - 9} ${to - arrowHead},${arrowY + 9}" fill="${brand.accent}"/>`;
        })
        .join("\n    ");

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${brand.bg}"/>

  <!-- Hairline frame, echoing the bordered cards the site is built from. -->
  <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="10" fill="none" stroke="${brand.line}" stroke-width="2"/>

  <!-- The mark, as a bug in the top-right. Same geometry as the favicon. -->
  <line x1="${bugX + markSize * 0.2}" y1="${bugY + markSize * 0.82}" x2="${bugX + markSize * 0.8}" y2="${bugY + markSize * 0.18}" stroke="${brand.accent}" stroke-width="${Math.round(markSize * 0.14)}" stroke-linecap="square"/>

  <g font-family="JetBrains Mono, ui-monospace, monospace">
    <text x="${pad}" y="${headY}" font-size="${headSize}" font-weight="500" fill="${brand.fg}">${copy.tagline}</text>

    <!-- Arrows first, so a box always paints over one rather than under it. -->
    ${arrows}

    <g>
      ${cells}
    </g>

    <!-- Wordmark. Three runs, positioned by exact monospace advance. -->
    <g font-size="${wordSize}" font-weight="700">
      <text x="${pad}" y="${wordY}" fill="${brand.fg}">${copy.wordmarkLeft}</text>
      <text x="${pad + leftW}" y="${wordY}" fill="${brand.accent}">${copy.wordmarkSlash}</text>
      <text x="${pad + leftW + slashW}" y="${wordY}" fill="${brand.fg}">${copy.wordmarkRight}</text>
    </g>
  </g>
</svg>`;
}
