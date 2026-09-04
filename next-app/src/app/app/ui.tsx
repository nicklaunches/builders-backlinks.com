import { ArrowRight, LogIn } from "lucide-react";

/**
 * @file The pieces every document-shaped `/app` page is built from.
 *
 * Server components only, no state. The layout owns the header and the tab
 * bar, so nothing here renders chrome: a page is a {@link PageFrame} with
 * {@link Section}s inside it, and a signed-out page is the same frame around a
 * {@link SignInPrompt}. The inbox is the one `/app` page that does not use the
 * frame, because it is bound to the viewport rather than the document.
 *
 * The title is deliberately small. These pages used to open with a marketing
 * eyebrow, a 2.5rem heading and a lede, which pushed the first useful row below
 * the fold on a laptop; the tab bar already says where the member is.
 */

/** The centred column with a compact title. */
export function PageFrame({ title, lede, children }: { title: string; lede?: string; children: React.ReactNode }) {
    return (
        <main id="main">
            <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6 sm:py-10">
                <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
                {lede ? <p className="text-muted mt-2 text-[14.5px] leading-relaxed">{lede}</p> : null}
                <div className="mt-8 space-y-8">{children}</div>
            </div>
        </main>
    );
}

export function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
    return (
        <section>
            <h2 className="text-muted mb-3 font-mono text-[11px] tracking-[0.14em] uppercase">
                {title}
                {count ? ` · ${count}` : ""}
            </h2>
            {children}
        </section>
    );
}

export function Empty({ children }: { children: React.ReactNode }) {
    return (
        <p className="border-line bg-surface text-muted rounded-sm border p-8 text-center text-[14.5px] leading-relaxed">
            {children}
        </p>
    );
}

export function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-2/60 p-4">
            <dt className="text-muted font-mono text-[10.5px] tracking-[0.14em] uppercase">{label}</dt>
            <dd className="mt-1 text-[20px] font-semibold">{value}</dd>
        </div>
    );
}

/**
 * The signed-out state of a member page.
 *
 * `callbackUrl` is the page itself, including any id in it, so that an email
 * link to one thread comes back to that thread after sign-in rather than to
 * the top of the inbox.
 */
export function SignInPrompt({
    callbackUrl,
    title,
    body,
    cta = "Sign in",
}: {
    callbackUrl: string;
    title: string;
    body: string;
    cta?: string;
}) {
    const href = `/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
    return (
        <section aria-labelledby="signin-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <div className="border-line flex size-10 items-center justify-center rounded-sm border">
                <LogIn aria-hidden="true" className="size-4" />
            </div>
            <h2 id="signin-heading" className="mt-4 text-[19px] font-semibold">
                {title}
            </h2>
            <p className="text-muted mt-2 text-[14.5px] leading-relaxed">{body}</p>
            <a
                href={href}
                className="bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex items-center gap-2 rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors">
                {cta}
                <ArrowRight aria-hidden="true" className="size-4" />
            </a>
        </section>
    );
}
