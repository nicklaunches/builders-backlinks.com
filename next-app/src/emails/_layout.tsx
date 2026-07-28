import { Body, Container, Head, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";

import type { Placement } from "@/lib/models/ExchangeLink";
import type { PlacementOffer } from "@/lib/models/ExchangeSite";

import { getEmailContext, getSiteOrigin } from "./_context";

/**
 * @file Shared chrome and style tokens for every Builders Backlinks email.
 *
 * Every template renders through `EmailLayout`, so the card, the wordmark, and
 * the footer are written once. Per-template files then contain copy and nothing
 * else, which is what keeps a template diff readable.
 *
 * ## The colours are literal hex on purpose
 *
 * The site's palette lives in `src/app/globals.css` as custom properties. Mail
 * clients do not support custom properties (Outlook drops the declaration
 * whole, Gmail strips `:root` before the message is ever laid out), so the
 * values are inlined here. They are COPIED from that file rather than invented:
 * if the site theme moves, this file has to be updated by hand, and that is the
 * cheaper of the two failure modes.
 *
 * The accent rule from `globals.css` is enforced here as well, because it is an
 * accessibility rule and not a stylistic one. `#ff7a05` is 2.61:1 against white
 * and 2.61:1 under white, so it fails in BOTH directions and can only ever be a
 * FILL. Text sitting on that fill is near-black `#1a1206` (7.09:1). Accent
 * coloured text on the card ground is the darker `#b35200`. There is no case
 * where `#ff7a05` is correct as a `color`.
 *
 * ## No webfont
 *
 * The site loads Inter and JetBrains Mono. This does not, deliberately: a
 * transactional mail to a developer gains nothing from a 40KB font fetch that
 * half of mail clients strip anyway, and the system stacks below name both
 * faces first, so anyone who has them installed sees them.
 */

const FONT_STACK = "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const MONO_STACK = "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** Palette, copied from the light theme in `src/app/globals.css`. */
export const palette = {
    bg: "#fbfbfa",
    surface: "#ffffff",
    surface2: "#f4f5f3",
    line: "#e2e4e0",
    lineStrong: "#cfd2cc",
    fg: "#14161a",
    muted: "#5c6169",
    accent: "#ff7a05",
    /** What sits ON the accent fill. Near-black, never white. */
    accentFg: "#1a1206",
    accentSoft: "#fff2e5",
    /** Accent-coloured TEXT on the card ground. */
    accentText: "#b35200",
    ok: "#166534",
    warn: "#92400e",
} as const;

type LayoutProps = {
    /** Inbox preview line. Say the actual news, not the subject again. */
    preview: string;
    children: ReactNode;
    /**
     * Explicit override for the footer unsubscribe link. When omitted the
     * layout uses `EmailRenderContextValue.unsubscribeUrl`, which `sendEmail`
     * injects per recipient. Pass `null` to hide it: transactional mail about a
     * match you are in the middle of has nothing to opt out of.
     */
    unsubscribeUrl?: string | null;
};

export function EmailLayout({ preview, children, unsubscribeUrl }: LayoutProps) {
    const ctx = getEmailContext();
    const resolvedUnsubscribeUrl = unsubscribeUrl === null ? undefined : (unsubscribeUrl ?? ctx.unsubscribeUrl);
    const origin = getSiteOrigin();

    return (
        <Html lang="en">
            <Head />
            <Preview>{preview}</Preview>
            <Body style={body}>
                <Container style={container}>
                    <Section style={{ margin: "0 0 24px" }}>
                        <Link href={origin} style={wordmark}>
                            <span style={{ color: palette.fg }}>builders</span>
                            <span style={{ color: palette.accentText }}>/</span>
                            <span style={{ color: palette.fg }}>backlinks</span>
                        </Link>
                    </Section>
                    {children}
                    <Hr style={styles.hr} />
                    <Text style={footer}>
                        A backlink exchange for indie builders, driven from your coding agent over MCP.
                    </Text>
                    {resolvedUnsubscribeUrl ? (
                        <Text style={footer}>
                            <Link href={resolvedUnsubscribeUrl} style={footerLink}>
                                Unsubscribe
                            </Link>
                        </Text>
                    ) : null}
                </Container>
            </Body>
        </Html>
    );
}

/**
 * A label/value list.
 *
 * A real `<table>` rather than flexbox or a definition list: Outlook renders
 * the Word engine, where `display:flex` does nothing at all, and these emails
 * are mostly rows of facts, so getting this one primitive right removes the
 * layout question from every template.
 *
 * `data-text-format="dataTable"` is load-bearing, not decoration. React Email's
 * plain-text pass looks for exactly that attribute and, without it, flattens a
 * table into its concatenated cell text: "CategoryDeveloper ToolsDomain
 * Rating34". The plain-text body is what Apple Watch, screen readers, and
 * several spam scorers read, so it has to survive on its own.
 */
export function Facts({ rows }: { rows: readonly { label: string; value: ReactNode }[] }) {
    return (
        <table cellPadding={0} cellSpacing={0} role="presentation" data-text-format="dataTable" style={factTable}>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.label}>
                        <td style={factLabel}>{row.label}</td>
                        <td style={factValue}>{row.value}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/**
 * A monospace block for a snippet the reader is expected to copy.
 *
 * `wordBreak` is deliberate: an unbroken URL in a 560px card overflows the
 * container in every client, and a horizontally clipped snippet is worse than
 * an ugly wrap because the reader cannot tell that it was clipped.
 */
export function CodeBlock({ children }: { children: ReactNode }) {
    return <Text style={styles.code}>{children}</Text>;
}

/**
 * How a stored enum reads in a sentence.
 *
 * These live with the chrome rather than next to the schema because they are
 * email copy, not domain vocabulary: the same `blog_post` value is phrased
 * differently on the dashboard, and the two should be free to diverge without
 * one importing the other's wording.
 */
export function placementOfferLabel(offer: PlacementOffer): string {
    switch (offer) {
        case "blog_post":
            return "A link inside a blog post";
        case "resources_page":
            return "A slot on a resources page";
        case "existing_article":
            return "A mention in an existing article";
        case "unsure":
        default:
            return "Not decided yet";
    }
}

/**
 * Where a link landed, said plainly.
 *
 * Stated, never judged. A footer link is reported as a footer link and still
 * counts: members were promised that where the link lands is their call, and
 * this wording has to stay consistent with that promise.
 */
export function placementLabel(placement: Placement): string {
    switch (placement) {
        case "content":
            return "In the page content";
        case "footer":
            return "In the footer";
        case "nav":
            return "In the navigation";
        case "sidebar":
            return "In the sidebar";
        case "unknown":
        default:
            return "Position not determined";
    }
}

/** `rel` tokens as a reader sees them. Disclosure, not a verdict. */
export function relLabel(rel: readonly string[]): string {
    const flags = rel.filter((token) => token === "nofollow" || token === "sponsored" || token === "ugc");
    if (flags.length === 0) return "dofollow";
    return flags.join(", ");
}

/** A DR that may be missing. Never renders a bare "null" at a member. */
export function drLabel(domainRating: number | null): string {
    return domainRating === null ? "not available" : String(domainRating);
}

const body: CSSProperties = {
    backgroundColor: palette.bg,
    margin: 0,
    padding: "24px",
    fontFamily: FONT_STACK,
};

const container: CSSProperties = {
    backgroundColor: palette.surface,
    border: `1px solid ${palette.line}`,
    borderRadius: "12px",
    padding: "32px",
    maxWidth: "560px",
    margin: "0 auto",
    fontFamily: FONT_STACK,
};

const wordmark: CSSProperties = {
    fontFamily: MONO_STACK,
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textDecoration: "none",
};

const footer: CSSProperties = {
    fontFamily: FONT_STACK,
    fontSize: "12px",
    lineHeight: "18px",
    color: palette.muted,
    margin: "0 0 4px",
};

const footerLink: CSSProperties = {
    color: palette.muted,
    textDecoration: "underline",
};

const factTable: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    margin: "0 0 20px",
};

const factLabel: CSSProperties = {
    fontFamily: FONT_STACK,
    fontSize: "13px",
    lineHeight: "20px",
    color: palette.muted,
    padding: "8px 16px 8px 0",
    borderBottom: `1px solid ${palette.line}`,
    verticalAlign: "top",
    whiteSpace: "nowrap",
    width: "40%",
};

const factValue: CSSProperties = {
    fontFamily: FONT_STACK,
    fontSize: "13px",
    lineHeight: "20px",
    color: palette.fg,
    padding: "8px 0",
    borderBottom: `1px solid ${palette.line}`,
    verticalAlign: "top",
    wordBreak: "break-word",
};

/**
 * Style tokens shared by every template.
 *
 * Each text block carries its own `fontFamily`. Gmail rewrites styles onto raw
 * tags and will force Arial onto a `<p>` that does not state one, so inheriting
 * from the container is not enough.
 */
export const styles = {
    heading: {
        fontFamily: FONT_STACK,
        fontSize: "20px",
        fontWeight: 700,
        lineHeight: "28px",
        color: palette.fg,
        margin: "0 0 12px",
        letterSpacing: "-0.02em",
    } satisfies CSSProperties,
    subheading: {
        fontFamily: FONT_STACK,
        fontSize: "13px",
        fontWeight: 600,
        lineHeight: "20px",
        color: palette.fg,
        margin: "24px 0 8px",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
    } satisfies CSSProperties,
    paragraph: {
        fontFamily: FONT_STACK,
        fontSize: "14px",
        lineHeight: "22px",
        color: palette.fg,
        margin: "0 0 16px",
    } satisfies CSSProperties,
    muted: {
        fontFamily: FONT_STACK,
        fontSize: "12px",
        lineHeight: "18px",
        color: palette.muted,
        margin: "0 0 12px",
    } satisfies CSSProperties,
    accentText: {
        color: palette.accentText,
    } satisfies CSSProperties,
    link: {
        color: palette.accentText,
        textDecoration: "underline",
    } satisfies CSSProperties,
    button: {
        fontFamily: FONT_STACK,
        backgroundColor: palette.accent,
        color: palette.accentFg,
        fontWeight: 600,
        fontSize: "14px",
        padding: "11px 20px",
        borderRadius: "8px",
        textDecoration: "none",
        display: "inline-block",
    } satisfies CSSProperties,
    buttonSecondary: {
        fontFamily: FONT_STACK,
        backgroundColor: palette.surface,
        color: palette.fg,
        fontWeight: 600,
        fontSize: "14px",
        padding: "10px 19px",
        border: `1px solid ${palette.lineStrong}`,
        borderRadius: "8px",
        textDecoration: "none",
        display: "inline-block",
        marginLeft: "8px",
    } satisfies CSSProperties,
    btnWrap: {
        margin: "4px 0 24px",
    } satisfies CSSProperties,
    hr: {
        borderColor: palette.line,
        borderStyle: "solid",
        borderWidth: "1px 0 0",
        margin: "28px 0 16px",
    } satisfies CSSProperties,
    card: {
        backgroundColor: palette.surface2,
        border: `1px solid ${palette.line}`,
        borderRadius: "10px",
        padding: "16px 18px",
        margin: "0 0 12px",
    } satisfies CSSProperties,
    code: {
        fontFamily: MONO_STACK,
        backgroundColor: palette.surface2,
        border: `1px solid ${palette.line}`,
        borderRadius: "8px",
        padding: "12px 14px",
        fontSize: "12px",
        lineHeight: "20px",
        color: palette.fg,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: "0 0 16px",
    } satisfies CSSProperties,
    mono: {
        fontFamily: MONO_STACK,
        fontSize: "12px",
    } satisfies CSSProperties,
    listItem: {
        fontFamily: FONT_STACK,
        fontSize: "13px",
        lineHeight: "21px",
        color: palette.fg,
        margin: "0 0 8px",
    } satisfies CSSProperties,
};
