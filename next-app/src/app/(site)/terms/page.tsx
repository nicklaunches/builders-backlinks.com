/**
 * @file `/terms`: what you agree to by using the exchange.
 *
 * Written to describe THIS service, not a service in general. Every clause here
 * corresponds to something the code actually does: review before active
 * (`status: "pending_review"` in `services/sites.ts`), one domain per member
 * (the unique `domain` index on `ExchangeSite`), five sites per member
 * (`MAX_SITES_PER_MEMBER`), classify-never-reject (`services/links.ts` and
 * `lib/verify`), grace on the first two exchanges (`getStanding`), and a soft
 * disable on unsubscribe (`unsubscribedAt`). If one of those changes, this page
 * is wrong, not merely stale.
 *
 * The section that matters most legally is "What we do not promise". This is an
 * SEO-adjacent product, the category is full of people implying ranking
 * outcomes, and both the honest position and the safe position are the same
 * one: we make no claim about what any search engine will do with any link.
 * Do not soften it.
 *
 * Server component.
 */
import type { Metadata } from "next";

import { OnThisPage, PageHeader } from "@/components/web/page-header";
import { Callout, Code, Prose, Section } from "@/components/web/prose";
import { SiteFooter } from "@/components/web/site-footer";
import { SiteHeader } from "@/components/web/site-header";

const LAST_UPDATED = "27 July 2026";
const CONTACT = "hello@builders-backlinks.com";

export const metadata: Metadata = {
    title: "Terms",
    description:
        "The plain-language terms for Builders Backlinks: a free reciprocal link exchange. What gets a site listed, what gets it " +
        "refused, how reciprocity is expected to work, and why we promise nothing about search rankings.",
    alternates: { canonical: "/terms" },
};

const SECTIONS = [
    { href: "#what", label: "What this is" },
    { href: "#account", label: "Your account" },
    { href: "#listing", label: "Listing a site" },
    { href: "#refused", label: "What gets refused or paused" },
    { href: "#reciprocity", label: "Giving as well as taking" },
    { href: "#placement", label: "Where the link goes" },
    { href: "#verification", label: "Verification and crawling" },
    { href: "#no-promises", label: "What we do not promise" },
    { href: "#key", label: "Your API key" },
    { href: "#automation", label: "Agents and automation" },
    { href: "#ending", label: "Ending it" },
    { href: "#changes", label: "Changes and contact" },
] as const;

export default function TermsPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow="Terms of use"
                    title="The deal, in plain words"
                    lede="A free reciprocal link exchange, run by one person, at an early stage. These terms describe what the service actually does rather than what a template says a service might do."
                    meta={`Last updated ${LAST_UPDATED}`}>
                    <OnThisPage items={SECTIONS} />
                </PageHeader>

                <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-16">
                    <Callout title="Read this first">
                        These are the current plain-language terms for an early-stage, free service. They are written to
                        be understood rather than to be impressive, and they are not legal advice. If you need advice
                        about your own situation, get it from a lawyer in your own jurisdiction. If anything below is
                        unclear, ask us and we will fix the wording rather than hide behind it.
                    </Callout>

                    {/* -------------------------------------------------------
                        What this is
                    ------------------------------------------------------- */}
                    <Section id="what" title="1. What this is">
                        <Prose>
                            <p>
                                Builders Backlinks introduces two website owners who might reasonably link to each
                                other, tells each of them what the other site is about without saying which site it is,
                                and then checks whether the links they agreed on actually went live. You drive it from a
                                coding agent over MCP, or from the website.
                            </p>
                            <p>
                                <strong>It is free.</strong> There are no fees, no paid tiers, no credits, no priority
                                placement, and no way to pay for a better match. There is no marketplace and no money
                                moving between members: a trade is one relevant link each, out in the open. If that ever
                                changes, existing members will be told before it does, not after.
                            </p>
                            <p>
                                By listing a site, calling an authenticated tool, or using the website while signed in,
                                you are agreeing to what is on this page.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Account
                    ------------------------------------------------------- */}
                    <Section id="account" title="2. Your account is shared with nicklaunches.com">
                        <Prose>
                            <p>
                                Builders Backlinks and <a href="https://nicklaunches.com">nicklaunches.com</a> are run
                                by the same person and share one account system. Signing in on either site resolves to
                                the same underlying user, so the email address, the sign-in method and the identity
                                behind them are common to both. Your session cookie is per-domain, so signing in on one
                                does not silently sign you in on the other, but it is one account.
                            </p>
                            <p>
                                Exchange-specific state (your sites, matches, links, API key hash and digest settings)
                                is kept separately from that shared account, and this service never writes to the shared
                                user record. Deleting your exchange data does not delete your nicklaunches.com account,
                                and the reverse is also true. Ask if you want both gone.
                            </p>
                            <p>
                                You need to be old enough to enter into a contract where you live, and you must give a
                                real email address you control.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Listing
                    ------------------------------------------------------- */}
                    <Section id="listing" title="3. Listing a site">
                        <Prose>
                            <p>
                                You may list a site if you own it or are authorised to place links on it. That is the
                                whole test. If you cannot publish a link on a page without asking someone else, the site
                                is not yours to trade with.
                            </p>
                            <ul>
                                <li>
                                    <strong>Every new site is reviewed before it goes active.</strong> A submitted site
                                    starts as <Code>pending_review</Code>. It is not matched with anyone until a human
                                    has looked at it. Sites imported from an already-approved nicklaunches.com product
                                    skip that step, because they were reviewed there.
                                </li>
                                <li>
                                    <strong>One domain belongs to one member, permanently.</strong> A domain can be
                                    listed once, by one account. If it is already in the exchange you cannot list it
                                    again, and if it is genuinely yours and someone else listed it, tell us and we will
                                    sort it out.
                                </li>
                                <li>
                                    <strong>Up to five sites per member.</strong> Enough for someone who ships a lot,
                                    not enough to farm the pool.
                                </li>
                                <li>
                                    <strong>The listing text is drafted for you, and approved by you.</strong> We fetch
                                    your homepage and have a language model write a description that says what the site
                                    does without naming it. You see that draft before anything is published, and you can
                                    rewrite it. Once you confirm, the words are yours: keep them accurate, and keep them
                                    free of anything you would not want a stranger to read.
                                </li>
                                <li>
                                    <strong>Domain Rating comes from VerifiedDR and is fetched by us.</strong> It is a
                                    sorting hint, never a gate, and it is never accepted from a caller, so there is
                                    nothing to inflate.
                                </li>
                            </ul>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Refused
                    ------------------------------------------------------- */}
                    <Section id="refused" title="4. What gets a site refused, paused or removed">
                        <Prose>
                            <p>
                                The exchange only works if the links are worth having, so the bar is about the site, not
                                about how much we like it. A site can be refused at review, or paused later, if it is:
                            </p>
                            <ul>
                                <li>
                                    a private blog network, a link farm, a link directory, or any site whose main
                                    purpose is holding outbound links;
                                </li>
                                <li>
                                    a thin or doorway site, a content mill, or a page with so little real content that
                                    we cannot honestly describe what it is;
                                </li>
                                <li>
                                    a parked domain, an expired-domain rebuild, or a site that is dead or unreachable;
                                </li>
                                <li>
                                    not yours, or a site where you cannot actually place a link when a match asks for
                                    one;
                                </li>
                                <li>
                                    illegal, or dedicated to malware, phishing, scraped or stolen content, or sexual
                                    content involving minors;
                                </li>
                                <li>
                                    listed under a description that misrepresents what it is, whether that description
                                    was drafted by us or rewritten by you.
                                </li>
                            </ul>
                            <p>
                                Automated checks help, but a person decides. If your site is refused you will be told
                                why, and if you think we got it wrong, say so: a wrong rejection is a bug and we would
                                rather hear about it than lose a real site. A refused or paused site simply stops being
                                matched. Nothing is deleted, and clearing the cause restores it.
                            </p>
                            <p>
                                Sites in the catch-all <Code>Other</Code> category are never matched, because matching
                                inside a bucket that means nothing produces exactly the off-topic pairs that make link
                                exchanges look like schemes. You will be asked to pick a real category instead.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Reciprocity
                    ------------------------------------------------------- */}
                    <Section id="reciprocity" title="5. Giving as well as taking">
                        <Prose>
                            <p>
                                Every exchange is one relevant link each. There are no credits, no points, no way to
                                bank a debt, and no way to buy your way up a queue. Accepting a match is a statement
                                that you are willing to place a link, not only that you would like to receive one.
                            </p>
                            <ul>
                                <li>
                                    <strong>Your first two exchanges are grace.</strong> Somebody has to place the first
                                    link in any pair, and penalising the person who does would be exactly backwards.
                                    Nothing is expected back until you have traded.
                                </li>
                                <li>
                                    <strong>After that, standing is visible to you at any time.</strong> Call{" "}
                                    <Code>get_my_standing</Code> and you will see whether you are healthy, worth evening
                                    up, or behind, and why.
                                </li>
                                <li>
                                    <strong>If you take without giving, matching stops finding you partners.</strong>{" "}
                                    That is the entire consequence in the normal case. We do not fine you, we do not
                                    chase you, and we do not ask your partner to remove anything. We stop introducing
                                    you to people, because it is not fair to them.
                                </li>
                                <li>
                                    <strong>Persistent or deliberate taking gets the account paused.</strong> Accepting
                                    matches to harvest partner domains and emails with no intention of placing anything
                                    is the clearest case, and it ends the account rather than adjusting a score.
                                </li>
                            </ul>
                            <p>
                                If you cannot place a link for a good reason, decline the match. Declining costs you
                                nothing and is far better for everyone than accepting and going quiet.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Placement policy
                    ------------------------------------------------------- */}
                    <Section id="placement" title="6. Where the link goes is your call">
                        <Prose>
                            <p>We classify placements. We do not referee them, and we never reject one.</p>
                            <p>
                                When a link is marked placed, we fetch the page and record what is actually there: where
                                the link sits (in content, in a footer, in navigation, in a sidebar), whether it is
                                dofollow or carries <Code>nofollow</Code>, <Code>sponsored</Code> or <Code>ugc</Code>,
                                what the anchor text is, and whether the same link appears across the site. Both you and
                                your partner see exactly the same record, for both directions.
                            </p>
                            <p>
                                A footer link counts. A nofollow link counts. What changes is that your partner can see
                                it, as you can see theirs. Full disclosure in both directions, and the two of you decide
                                whether the trade was fair. We will never tell you which page to use, insist on a
                                particular anchor, or void a trade because a placement was not generous enough.
                            </p>
                            <p>
                                What you publish on your own site is your responsibility, including any disclosure or
                                labelling your jurisdiction, your platform or your own editorial policy requires. If you
                                accept a match, place the link honestly, in a place a reader could plausibly benefit
                                from it.
                            </p>
                        </Prose>

                        <Callout title="No money, ever, in either direction" tone="accent">
                            Links traded here are exchanged, not bought or sold. Do not offer a member money for a
                            placement and do not accept it. If a member approaches you with a paid link offer after a
                            reveal, that is between you and them and outside this service, but tell us and we will look
                            at whether they belong here.
                        </Callout>
                    </Section>

                    {/* -------------------------------------------------------
                        Verification
                    ------------------------------------------------------- */}
                    <Section id="verification" title="7. Verification and crawling">
                        <Prose>
                            <p>
                                By listing a site you are asking us to fetch it, and by marking a link placed you are
                                asking us to fetch that page. We do both with a clearly identified crawler,{" "}
                                <Code>BuildersBacklinksBot/1.0</Code>, over ordinary public HTTP requests, and only
                                against pages you have pointed us at.
                            </p>
                            <ul>
                                <li>
                                    We check a placement immediately, then again at day 7, day 30, and monthly after
                                    that.
                                </li>
                                <li>
                                    If a link comes down later, both parties are told. That is the point of checking.
                                </li>
                                <li>
                                    We read server-rendered HTML only. A link added by JavaScript is invisible to us
                                    even when it is genuinely on the page, so a link we cannot find is reported as
                                    inconclusive, not as a missing link and never as an accusation.
                                </li>
                                <li>
                                    We may fetch a small number of other pages on your site to work out whether a
                                    placement is sitewide. Nothing else is crawled.
                                </li>
                            </ul>
                            <p>
                                If you block our crawler, we cannot verify your side of a trade, and unverifiable trades
                                do not count toward your standing.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        No promises
                    ------------------------------------------------------- */}
                    <Section id="no-promises" title="8. What we do not promise">
                        <Prose>
                            <p>This is the most important section on the page, and it is short.</p>
                        </Prose>

                        <Callout title="No ranking, traffic or SEO outcome is promised, implied, or possible to promise">
                            <p>
                                We make no representation, warranty or guarantee that any link obtained through this
                                service will be crawled, indexed, counted, retained, or treated as valuable by Google or
                                any other search engine, or that it will improve your rankings, your traffic, your
                                revenue, or any other metric. How search engines treat reciprocal links is entirely
                                their decision, it changes without notice, and nobody who tells you otherwise knows
                                something we do not.
                            </p>
                            <p>
                                Nothing on this site is SEO advice or professional advice of any kind. You are
                                responsible for deciding whether trading a link is appropriate for your site, and for
                                any consequence to your site if a search engine disagrees.
                            </p>
                        </Callout>

                        <Prose className="mt-6">
                            <p>
                                Beyond that, the ordinary early-stage caveats apply, stated plainly rather than in
                                capitals:
                            </p>
                            <ul>
                                <li>
                                    The service is provided as it is, with no warranty of any kind. It may be
                                    unavailable, it may lose data, and matching may simply not find you anyone.
                                </li>
                                <li>
                                    We do not vouch for other members, their sites, their conduct after a reveal, or
                                    whether they keep a link up. We record what happened; we cannot control it.
                                </li>
                                <li>
                                    We may change how matching works, change or remove tools, or stop the service. If we
                                    shut it down, we will tell members by email first and give reasonable notice.
                                </li>
                                <li>
                                    To the fullest extent the law where you live allows, our total liability to you for
                                    anything connected with this service is limited to what you have paid us, which is
                                    nothing. Some jurisdictions do not allow certain exclusions, and where that is the
                                    case, this clause applies only as far as it legally can.
                                </li>
                            </ul>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        API key
                    ------------------------------------------------------- */}
                    <Section id="key" title="9. Your API key">
                        <Prose>
                            <p>
                                Your <Code>bb_live_</Code> key is a password. Anything done with it is treated as done
                                by you, so keep it out of committed files, screenshots and shared logs.
                            </p>
                            <p>
                                We store only a SHA-256 hash of it. That means we genuinely cannot show it to you again,
                                recover it, or read it out of our own database. If you lose it, mint a new one, which
                                invalidates the old one. If you think it has leaked, do that immediately and tell us.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Automation
                    ------------------------------------------------------- */}
                    <Section id="automation" title="10. Agents and automation">
                        <Prose>
                            <p>
                                Agents are the intended way to use this. Automating your own trades end to end is
                                encouraged, not merely tolerated. Two limits on that:
                            </p>
                            <ul>
                                <li>
                                    <strong>A human approves your listing text.</strong> The description is shown to
                                    strangers, so <Code>submit_site</Code> deliberately drafts first and writes only on
                                    a second, explicit call. Do not wire around that.
                                </li>
                                <li>
                                    <strong>Do not enumerate the member base.</strong> Walking the anonymous read tools
                                    to build a copy of the pool, or trying to correlate masked profiles back to real
                                    domains, is the one thing that would break the promise every member joined for. It
                                    gets a key revoked without warning.
                                </li>
                            </ul>
                            <p>
                                Beyond that: no attacks on the service, no attempts to reach other members&rsquo; data,
                                no probing for holes in the masking boundary, and no reselling access. If you find a
                                security or privacy flaw, report it to us before anyone else and we will thank you
                                properly.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Ending it
                    ------------------------------------------------------- */}
                    <Section id="ending" title="11. Ending it">
                        <Prose>
                            <p>
                                <strong>You can leave at any time.</strong> Unsubscribing stops the digests, drops your
                                sites out of matching, and disables your API key. Nothing is deleted by that, so
                                resubscribing restores everything. If you want the data actually removed, ask, and see
                                the <a href="/privacy">privacy notice</a> for what deletion does and does not reach.
                            </p>
                            <p>
                                <strong>We can pause or remove a site or an account</strong> for anything in section 4,
                                for taking without giving as described in section 5, or for the conduct in section 10.
                                Where it is a judgment call rather than something obvious, we will tell you why and give
                                you a chance to answer.
                            </p>
                            <p>
                                Links that are already published stay a matter between you and your partner. We do not
                                require anyone to remove a live link when an account ends, and we cannot make your
                                partner keep theirs. What we stop doing is introducing you to anyone new and checking
                                what happens next.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Changes and contact
                    ------------------------------------------------------- */}
                    <Section id="changes" title="12. Changes and contact">
                        <Prose>
                            <p>
                                When these terms change, the date at the top changes with them. For anything that
                                actually affects members (how matching works, what gets a site removed, or anything to
                                do with money if that ever exists) we will email members rather than quietly editing the
                                page.
                            </p>
                            <p>
                                Questions, disputes, corrections, or a rejection you think is wrong: email{" "}
                                <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. A real person reads it.
                            </p>
                            <p className="text-[14px]">Last updated {LAST_UPDATED}.</p>
                        </Prose>
                    </Section>
                </div>
            </main>

            <SiteFooter />
        </>
    );
}
