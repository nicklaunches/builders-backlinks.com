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
        body: "Every other exchange hands you an email address and wishes you luck. Placing the link is where trades die: open the editor, find the right page, write a sentence that does not read like a favour, commit, deploy. Your agent is already in the repo, so that whole stretch collapses into one instruction.",
    },
    {
        icon: Target,
        title: "Matched inside your category, banded by DR",
        body: "Off-topic links help nobody and read like a scheme. You are matched inside your own category, and only widened by one editorially sensible step when a category is genuinely thin (we tell you when we did). Domain Rating is banded, so neither side feels shortchanged before they even reply.",
    },
    {
        icon: ShieldCheck,
        title: "We verify, and we keep checking",
        body: "Both links are fetched and classified the moment they are marked placed, then again on day 7, day 30, and monthly after that. If a link is quietly pulled six weeks later, the other side hears about it. Nobody else in this category records whether the trade actually happened.",
    },
] as const;

const STEPS = [
    {
        n: "01",
        title: "Submit your site",
        body: "Paste a URL. We read the page and draft the listing: category, an identity-scrubbed description, suggested anchors, and DR. Your URL and your email stay hidden from partners until you both agree.",
    },
    {
        n: "02",
        title: "Get matched in your category",
        body: "Matching runs weekly, or instantly if a partner in your category is already waiting. You see a masked profile: what the site is about, its DR band, the anchors it wants, the placement it offers. Not who it is.",
    },
    {
        n: "03",
        title: "Trade, and we verify",
        body: "Accept, and the two of you are revealed to each other. Place your link, mark it placed, and we check it. Then day 7, day 30, then monthly. Both sides see exactly the same record.",
    },
] as const;

type Rule = { title: string; body: string; emphasis?: boolean };

const RULES: readonly Rule[] = [
    {
        title: "Real sites only",
        body: "A live site, real content, a real owner. Parked domains, PBNs, expired-domain rebuilds and link farms are turned down at review. This only works if the links are worth having.",
    },
    {
        title: "Same category, or nothing",
        body: "You are matched inside your own category. When a category is too thin to pair, we widen by exactly one adjacent step and say so. We never pair at random, and some categories simply wait.",
    },
    {
        title: "One for one, reciprocal",
        body: "One link out, one link in. No credits, no points, no way to bank a debt or buy your way up a queue. If you stop placing your side, matching stops finding you partners.",
    },
    {
        title: "Where the link goes is your call",
        body: "We classify every placement (content, footer, nav, sidebar) and every rel (dofollow, nofollow, sponsored), and we tell both sides exactly what they gave and exactly what they got. We do not reject placements and we do not referee them. Full disclosure, both ways, and you decide whether the trade was fair.",
        emphasis: true,
    },
];

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
                            Roughly half of agreed link trades never become a published link. Not because anyone changed
                            their mind, but because placing it means opening an editor, finding the right page, writing
                            a sentence, committing, deploying. Your agent is already in the repo, so we put the whole
                            trade where the work happens.
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
                                        <span className="border-line bg-surface text-accent mb-4 inline-flex size-9 items-center justify-center rounded-lg border">
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
                                    <span className="text-accent font-mono text-[12px] tracking-[0.16em]">
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

                        <dl className="mt-10 grid gap-6 sm:mt-12 md:grid-cols-2 md:gap-7">
                            {RULES.map((rule) => (
                                <div
                                    key={rule.title}
                                    className={
                                        rule.emphasis
                                            ? "border-accent/35 bg-accent-soft rounded-xl border p-6 md:col-span-2"
                                            : "border-line bg-surface rounded-xl border p-6"
                                    }>
                                    <dt className="flex items-center gap-2 text-[15.5px] font-semibold">
                                        <span aria-hidden="true" className="text-accent font-mono">
                                            §
                                        </span>
                                        {rule.title}
                                    </dt>
                                    <dd className="text-muted mt-2.5 text-[14.5px] leading-relaxed">{rule.body}</dd>
                                </div>
                            ))}
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
                            Free, one for one, and your URL stays hidden until you both agree. Bring an agent, or use
                            the web form. Same exchange either way.
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
