/**
 * @file The landing page.
 *
 * Server component. Only the hero terminal and the web fallback form ship
 * JavaScript.
 *
 * Two rules this page is written against, both deliberate:
 *
 *   1. NO SCALE CLAIMS. No member counts, no site counts, no "N builders in
 *      Marketing". The exchange has zero members today. The reference
 *      competitor hardcodes fake numbers into its category pages and it is a
 *      liability, not an asset. Everything here argues capability instead.
 *   2. THE PLACEMENT POLICY IS STATED PLAINLY. We classify every placement and
 *      report it to both sides, and we never reject one. Softening that into
 *      "quality placements only" would be the easy marketing move and would
 *      make the product a referee, which it is not.
 *
 * Copy is kept short on purpose: one or two sentences per block. Every claim
 * here is true of the built product, so trimming is allowed but rewriting a
 * promise is not.
 *
 * House rules deliberately do NOT use the card rhythm of the two sections
 * above. Three of them are a hairline spec ledger and the fourth, the
 * placement policy, is a full-width panel, because it is the differentiated
 * position and should not look like the other three.
 */
import { ShieldCheck, Sparkles, Target, Terminal } from "lucide-react";

import { InstallTabs } from "@/components/web/install-tabs";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";
import { SubmitFallback } from "@/components/web/submit-fallback";

const VALUE_PROPS = [
    {
        icon: Terminal,
        title: "The agent does the part everyone else skips",
        body: "Other exchanges hand you an email address. Placing the link is where trades die, and your agent is already in the repo.",
    },
    {
        icon: Target,
        title: "Matched inside your category, banded by DR",
        body: "You are matched inside your own category and banded by DR, widened by one adjacent step only when a category is thin.",
    },
    {
        icon: ShieldCheck,
        title: "We verify, and we keep checking",
        body: "Both links are fetched and classified when marked placed, then again on day 7, day 30, and monthly. Pull one and the other side hears.",
    },
] as const;

const STEPS = [
    {
        n: "01",
        title: "Submit your site",
        body: "Paste a URL. We draft the listing (category, an identity-scrubbed description, anchors, DR) and keep your URL hidden until you both agree.",
    },
    {
        n: "02",
        title: "Get matched in your category",
        body: "Matching runs weekly, or instantly if a partner is waiting. You see a masked profile: category, DR band, the anchors it wants.",
    },
    {
        n: "03",
        title: "Trade, and we verify",
        body: "Accept, you are revealed to each other, and once you mark your link placed we check it and keep checking.",
    },
] as const;

type Rule = { title: string; body: string; emphasis?: boolean };

const RULES: readonly Rule[] = [
    {
        title: "Real sites only",
        body: "A live site, real content, a real owner. Parked domains, PBNs, expired-domain rebuilds and link farms are turned down.",
    },
    {
        title: "Same category, or nothing",
        body: "Matched inside your own category. If it is too thin to pair, we widen by exactly one adjacent step and say so.",
    },
    {
        title: "One for one, reciprocal",
        body: "One link out, one link in. No credits, no points, no queue to buy your way up.",
    },
    {
        title: "Where the link goes is your call",
        body: "We classify every placement (content, footer, nav, sidebar) and every rel (dofollow, nofollow, sponsored), and tell both sides what they gave and what they got. We never reject a placement and never referee one: you decide whether the trade was fair.",
        emphasis: true,
    },
];

/** The three rules that render as the hairline ledger. */
const LEDGER_RULES = RULES.filter((rule) => !rule.emphasis);

/** The placement policy. Rendered as its own panel, see the file header. */
const HEADLINE_RULE = RULES.find((rule) => rule.emphasis);

export default function LandingPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                {/* ---------------------------------------------------------------
                    Hero
                --------------------------------------------------------------- */}
                <section className="relative overflow-hidden">
                    <div
                        aria-hidden="true"
                        className="hairline-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_55%_at_50%_0%,black,transparent)] opacity-[0.35]"
                    />

                    <div className="relative mx-auto max-w-5xl px-5 pt-14 pb-16 sm:px-6 sm:pt-20 sm:pb-20">
                        <p className="text-muted mb-5 inline-flex items-center gap-2 font-mono text-[11.5px] tracking-[0.14em] uppercase">
                            <Sparkles aria-hidden="true" className="text-accent size-3.5" />
                            Free backlink exchange · driven over MCP
                        </p>

                        <h1 className="max-w-3xl text-[2.1rem] leading-[1.08] font-semibold tracking-[-0.025em] text-balance sm:text-[3rem] lg:text-[3.4rem]">
                            Trade backlinks from inside your coding agent.
                        </h1>

                        <p className="text-muted mt-5 max-w-2xl text-[16.5px] leading-relaxed sm:text-[17.5px]">
                            Roughly half of agreed link trades never become a published link. Your agent is already in
                            the repo, so we put the whole trade where the work happens.
                        </p>

                        <div className="mt-10">
                            <InstallTabs />
                        </div>
                    </div>
                </section>

                {/* ---------------------------------------------------------------
                    Web fallback. Prominent on purpose, see the component header.
                --------------------------------------------------------------- */}
                <section className="mx-auto max-w-5xl px-5 pb-16 sm:px-6 sm:pb-20">
                    <SubmitFallback />
                </section>

                {/* ---------------------------------------------------------------
                    Value props
                --------------------------------------------------------------- */}
                <section aria-labelledby="why" className="border-line border-t">
                    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
                        <h2 id="why" className="text-[1.6rem] font-semibold tracking-[-0.02em] sm:text-[2rem]">
                            Why this one is different
                        </h2>

                        <div className="mt-10 grid gap-8 sm:mt-12 md:grid-cols-3 md:gap-7">
                            {VALUE_PROPS.map((prop) => {
                                const Icon = prop.icon;
                                return (
                                    <article key={prop.title} className="flex flex-col">
                                        <span className="border-accent/30 bg-accent-soft text-accent-text mb-4 inline-flex size-9 items-center justify-center rounded-lg border">
                                            <Icon aria-hidden="true" className="size-[18px]" />
                                        </span>
                                        <h3 className="text-[16px] leading-snug font-semibold text-balance">
                                            {prop.title}
                                        </h3>
                                        <p className="text-muted mt-2.5 text-[14.5px] leading-relaxed">{prop.body}</p>
                                    </article>
                                );
                            })}
                        </div>
                    </div>
                </section>

                {/* ---------------------------------------------------------------
                    How it works
                --------------------------------------------------------------- */}
                <section id="how" aria-labelledby="how-heading" className="border-line bg-surface-2/60 border-t">
                    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
                        <h2 id="how-heading" className="text-[1.6rem] font-semibold tracking-[-0.02em] sm:text-[2rem]">
                            How it works
                        </h2>

                        <ol className="mt-10 grid gap-4 sm:mt-12 md:grid-cols-3 md:gap-5">
                            {STEPS.map((step) => (
                                <li key={step.n} className="border-line bg-surface flex flex-col rounded-xl border p-6">
                                    <span className="text-accent-text font-mono text-[12px] tracking-[0.16em]">
                                        {step.n}
                                    </span>
                                    <h3 className="mt-3 text-[16px] font-semibold">{step.title}</h3>
                                    <p className="text-muted mt-2.5 text-[14.5px] leading-relaxed">{step.body}</p>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* ---------------------------------------------------------------
                    House rules
                --------------------------------------------------------------- */}
                <section id="rules" aria-labelledby="rules-heading" className="border-line border-t">
                    <div className="mx-auto max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
                        <h2
                            id="rules-heading"
                            className="text-[1.6rem] font-semibold tracking-[-0.02em] sm:text-[2rem]">
                            House rules
                        </h2>
                        <p className="text-muted mt-3 max-w-2xl text-[15px] leading-relaxed">
                            Four of them, and they do not change per member.
                        </p>

                        {/* Spec ledger, not cards: hairline rows, mono rule name in a
                            fixed left column, prose on the right. Stacks on mobile. */}
                        <dl className="border-line mt-10 border-t sm:mt-12">
                            {LEDGER_RULES.map((rule, index) => (
                                <div
                                    key={rule.title}
                                    className="border-line grid gap-1.5 border-b py-5 md:grid-cols-[15rem_minmax(0,1fr)] md:gap-10 md:py-6">
                                    <dt className="flex items-baseline gap-2.5 font-mono text-[13.5px] font-medium tracking-[-0.01em]">
                                        <span aria-hidden="true" className="text-accent-text tabular-nums">
                                            §{String(index + 1).padStart(2, "0")}
                                        </span>
                                        {rule.title}
                                    </dt>
                                    <dd className="text-muted text-[14.5px] leading-relaxed">{rule.body}</dd>
                                </div>
                            ))}

                            {HEADLINE_RULE ? (
                                <div className="border-accent/35 bg-accent-soft relative mt-8 overflow-hidden rounded-xl border p-6 pl-7 sm:p-7 sm:pl-9">
                                    <span
                                        aria-hidden="true"
                                        className="bg-accent absolute inset-y-0 left-0 w-[3px] rounded-r-full"
                                    />
                                    <dt className="flex items-baseline gap-2.5">
                                        <span
                                            aria-hidden="true"
                                            className="text-accent-text font-mono text-[13.5px] tabular-nums">
                                            §04
                                        </span>
                                        <span className="text-[17px] font-semibold tracking-[-0.015em] text-balance sm:text-[19px]">
                                            {HEADLINE_RULE.title}
                                        </span>
                                    </dt>
                                    <dd className="text-muted mt-3 max-w-3xl text-[15px] leading-relaxed">
                                        {HEADLINE_RULE.body}
                                    </dd>
                                </div>
                            ) : null}
                        </dl>
                    </div>
                </section>

                {/* ---------------------------------------------------------------
                    Final CTA
                --------------------------------------------------------------- */}
                <section aria-labelledby="cta-heading" className="border-line bg-surface-2/60 border-t">
                    <div className="mx-auto max-w-5xl px-5 py-16 text-center sm:px-6 sm:py-24">
                        <h2
                            id="cta-heading"
                            className="mx-auto max-w-2xl text-[1.7rem] font-semibold tracking-[-0.025em] text-balance sm:text-[2.2rem]">
                            Add the server. Then say &ldquo;trade a link&rdquo;.
                        </h2>
                        <p className="text-muted mx-auto mt-4 max-w-xl text-[15.5px] leading-relaxed">
                            Free, one for one, and your URL stays hidden until you both agree. Agent or web form, same
                            exchange.
                        </p>

                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <a
                                href="/signin"
                                className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-[15px] font-semibold transition-colors sm:w-auto">
                                Get your key
                            </a>
                            <a
                                href="/docs/mcp"
                                className="border-line hover:border-line-strong hover:bg-surface inline-flex w-full items-center justify-center rounded-lg border px-6 py-3 text-[15px] font-medium transition-colors sm:w-auto">
                                Read the MCP docs
                            </a>
                        </div>
                    </div>
                </section>
            </main>

            <SiteFooter />
        </>
    );
}
