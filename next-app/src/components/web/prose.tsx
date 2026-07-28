/**
 * @file Long-form reading chrome for the docs and legal pages.
 *
 * The landing page is a sequence of short blocks and can carry its own type
 * sizes inline. `/docs/mcp`, `/terms` and `/privacy` are the opposite: several
 * thousand words that someone reads top to bottom, so they need one measure
 * (around 70 characters) and one rhythm applied in a single place rather than
 * restated on every element.
 *
 * TWO RULES THAT KEEP THIS FROM FIGHTING ITSELF.
 *
 * 1. `Prose` wraps PURE PROSE ONLY: paragraphs, lists, inline links. It styles
 *    its descendants, and a descendant selector (`.prose p`, specificity 0,1,1)
 *    beats a utility class on the element itself (`mt-3`, specificity 0,1,0).
 *    So a card component nested inside `Prose` cannot override anything it sets.
 *    Put cards, tables and code walkthroughs OUTSIDE `Prose`, as siblings.
 * 2. Headings live in `Section` and `Subheading`, not in `Prose`, for the same
 *    reason: a component that happens to contain an `h3` should keep control of
 *    it.
 *
 * `Prose` also deliberately does not style `code`. Inline code and code blocks
 * have opposite colour needs (one sits in body text, the other is a dark
 * terminal panel in both themes). Use `Code` and `CodeBlock` explicitly.
 *
 * Everything here is token-only: no literal colour appears in this file, so a
 * change to `--accent` is inherited without touching the content pages.
 */
import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";

/** A readable column of body text with one paragraph and list rhythm. */
export function Prose({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div
            className={cn(
                "max-w-[70ch] text-[15.5px] leading-[1.75]",
                "[&_p]:text-muted [&_p]:mt-4 [&_p:first-child]:mt-0",
                "[&_em]:text-fg [&_strong]:text-fg [&_em]:not-italic [&_strong]:font-semibold",
                "[&_ol]:mt-4 [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:mt-4 [&_ul]:space-y-2 [&_ul]:pl-5",
                "[&_li]:text-muted [&_li]:marker:text-accent",
                "[&_ol>li]:list-decimal [&_ul>li]:list-disc",
                // Underlined on purpose: colour alone is not an accessible signal.
                "[&_a]:text-accent [&_a]:underline [&_a]:decoration-from-font [&_a]:underline-offset-[3px]",
                className,
            )}>
            {children}
        </div>
    );
}

/** A top-level section with its own anchor target. */
export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section aria-labelledby={id} className="scroll-mt-20 pt-14 first:pt-0">
            <h2 id={id} className="scroll-mt-20 text-[1.4rem] font-semibold tracking-[-0.02em] sm:text-[1.55rem]">
                {title}
            </h2>
            <div className="mt-5">{children}</div>
        </section>
    );
}

/** A heading inside a section. */
export function Subheading({ id, children }: { id?: string; children: React.ReactNode }) {
    return (
        <h3 id={id} className="mt-10 scroll-mt-20 text-[16.5px] font-semibold">
            {children}
        </h3>
    );
}

/** Inline code. Sits in body text, so it uses page tokens, not terminal ones. */
export function Code({ children }: { children: React.ReactNode }) {
    return (
        <code className="border-line bg-surface-2 text-fg rounded-sm border px-1.5 py-0.5 font-mono text-[0.85em] whitespace-nowrap">
            {children}
        </code>
    );
}

/**
 * A copyable block of code or config.
 *
 * Pinned to the terminal palette in both themes, exactly like the hero install
 * panel, so a command reads the same wherever it appears on the site.
 */
export function CodeBlock({ code, label, copyLabel }: { code: string; label?: string; copyLabel?: string }) {
    return (
        <div className="border-term-line bg-term-bg mt-4 overflow-hidden rounded-sm border">
            <div className="border-term-line bg-term-chrome flex items-center justify-between gap-3 border-b px-3 py-2">
                <span className="text-term-dim font-mono text-[11px] tracking-[0.12em] uppercase">
                    {label ?? "shell"}
                </span>
                <CopyButton value={code} label={copyLabel ?? label ?? "code snippet"} />
            </div>
            <div className="overflow-x-auto px-4 py-3.5">
                <pre className="min-w-max font-mono text-[12.5px] leading-[1.75]">
                    <code>
                        {code.split("\n").map((line, index) => (
                            <span
                                key={index}
                                className={cn(
                                    "block whitespace-pre",
                                    line.trimStart().startsWith("#") ? "text-term-dim" : "text-term-bright",
                                )}>
                                {line === "" ? " " : line}
                            </span>
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    );
}

/**
 * A short aside: a caveat, a promise, or a thing people get wrong.
 *
 * `tone="accent"` is for the two or three statements on a page that are real
 * product promises. Everything else stays neutral so the accent keeps meaning
 * something.
 */
export function Callout({
    title,
    tone = "neutral",
    children,
}: {
    title: string;
    tone?: "neutral" | "accent";
    children: React.ReactNode;
}) {
    return (
        <aside
            className={cn(
                "mt-6 max-w-[70ch] rounded-sm border p-5",
                tone === "accent" ? "border-accent/35 bg-accent-soft" : "border-line bg-surface",
            )}>
            <div className="flex items-start gap-2 text-[15px] leading-snug font-semibold">
                <span aria-hidden="true" className="text-accent font-mono">
                    §
                </span>
                {title}
            </div>
            {/* Callouts sit OUTSIDE `Prose` (see the file header), so paragraph
                rhythm has to be provided here rather than inherited. */}
            <div className="text-muted mt-2.5 text-[14.5px] leading-relaxed [&_p]:mt-3 [&_p:first-child]:mt-0">
                {children}
            </div>
        </aside>
    );
}
