/**
 * @file Root layout: document shell, fonts, and site-wide metadata.
 *
 * Two typefaces only. Inter carries the prose; JetBrains Mono carries the
 * terminal, the install commands, and every domain or tool name on the page,
 * because this audience reads a monospace `bb_live_...` as "real" and a
 * proportional one as "marketing".
 */
import { GoogleAnalytics } from "@next/third-parties/google";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { GA_ID } from "@/lib/analytics";

import "./globals.css";

const sans = Inter({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-sans-face",
});

const mono = JetBrains_Mono({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-mono-face",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://builders-backlinks.com";

const DESCRIPTION =
    "A free backlink exchange for indie builders and small SaaS, driven from your coding agent over MCP. " +
    "Your agent finds the partner, writes the link into your repo, and we verify it went live.";

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: "Builders Backlinks: trade backlinks from inside your coding agent",
        template: "%s · Builders Backlinks",
    },
    description: DESCRIPTION,
    applicationName: "Builders Backlinks",
    keywords: [
        "backlink exchange",
        "link exchange",
        "MCP server",
        "Claude Code",
        "Cursor",
        "indie hackers",
        "SaaS SEO",
    ],
    alternates: { canonical: "/" },
    // No `images` key in either block, deliberately: `opengraph-image.png` and
    // `icon.png` are Next file conventions, so the framework emits the tags from
    // those files and file-based metadata wins over anything declared here.
    // Listing the paths again is a second source of truth that goes stale.
    // Regenerate both with `pnpm assets:generate`.
    openGraph: {
        type: "website",
        url: SITE_URL,
        siteName: "Builders Backlinks",
        title: "Trade backlinks from inside your coding agent",
        description: DESCRIPTION,
    },
    twitter: {
        card: "summary_large_image",
        title: "Trade backlinks from inside your coding agent",
        description: DESCRIPTION,
    },
    robots: { index: true, follow: true },
};

export const viewport: Viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
        { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
    ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="en" className={`${sans.variable} ${mono.variable}`}>
            <body className="bg-bg text-fg min-h-dvh antialiased">
                {children}
                {/* Cloudflare Web Analytics is on "Automatic setup" for this
                    zone and is injected at the edge, so it is deliberately not
                    rendered here. GA4 is the product analytics (the funnel
                    events in `lib/analytics.ts`) and loads only when the id was
                    set at build time. */}
                {GA_ID ? <GoogleAnalytics gaId={GA_ID} /> : null}
            </body>
        </html>
    );
}
