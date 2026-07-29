/**
 * @file The wordmark. A path, because the product is a two-sided trade.
 *
 * The slash is `text-accent-text`, NOT `text-accent`. The raw accent is 2.52:1
 * against the light ground, which fails for text at any size; `--accent-text`
 * is the role that exists for exactly this, at 4.92:1 in light and brighter
 * than the raw accent in dark. This is the rule stated at the top of
 * globals.css, and `src/emails/_layout.tsx` has always obeyed it.
 *
 * The generated icon and OG image use the raw accent instead, correctly: they
 * sit on the dark ground, where it is 7.54:1.
 */
import { cn } from "@/components/web/cn";

export function Wordmark({ className }: { className?: string }) {
    return (
        <span className={cn("font-mono text-[15px] font-semibold tracking-tight", className)}>
            <span className="text-fg">builders</span>
            <span className="text-accent-text">/</span>
            <span className="text-fg">backlinks</span>
        </span>
    );
}
