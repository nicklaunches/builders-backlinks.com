/**
 * @file The masthead shared by `/docs/mcp`, `/terms` and `/privacy`.
 *
 * Reuses the landing hero's language (hairline grid, mono eyebrow, tight
 * heading) so a content page reads as part of the same site rather than as a
 * bolted-on legal appendix. Server component: no state, no interactivity.
 */
import { cn } from "@/components/web/cn";

type PageHeaderProps = {
    /** Mono, uppercase, above the title. */
    eyebrow: string;
    title: string;
    /** One or two sentences. Sets expectations before the table of contents. */
    lede: string;
    /** Optional right-hand fact, e.g. a last-updated date or the endpoint. */
    meta?: string;
    children?: React.ReactNode;
};

export function PageHeader({ eyebrow, title, lede, meta, children }: PageHeaderProps) {
    return (
        <section className="border-line relative overflow-hidden border-b">
            <div
                aria-hidden="true"
                className={cn(
                    "hairline-grid pointer-events-none absolute inset-0 opacity-[0.35]",
                    "[mask-image:radial-gradient(70%_60%_at_30%_0%,black,transparent)]",
                )}
            />

            <div className="relative mx-auto max-w-3xl px-5 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
                <p className="text-muted mb-4 font-mono text-[11.5px] tracking-[0.14em] uppercase">{eyebrow}</p>

                <h1 className="text-[2rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.5rem]">
                    {title}
                </h1>

                <p className="text-muted mt-4 max-w-[62ch] text-[16px] leading-relaxed">{lede}</p>

                {meta ? <p className="text-muted mt-5 font-mono text-[12px]">{meta}</p> : null}

                {children}
            </div>
        </section>
    );
}

/**
 * A flat anchor index for a long page.
 *
 * Deliberately not sticky and not collapsible: it is read once, at the top, by
 * someone deciding whether the answer they want is on this page at all.
 */
export function OnThisPage({ items }: { items: readonly { href: string; label: string }[] }) {
    return (
        <nav aria-label="On this page" className="border-line bg-surface mt-8 rounded-xl border p-5">
            <p className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">On this page</p>
            <ol className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {items.map((item, index) => (
                    <li key={item.href} className="flex items-baseline gap-2.5">
                        <span aria-hidden="true" className="text-muted font-mono text-[11.5px]">
                            {String(index + 1).padStart(2, "0")}
                        </span>
                        <a href={item.href} className="hover:text-accent text-[14.5px] transition-colors">
                            {item.label}
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
    );
}
