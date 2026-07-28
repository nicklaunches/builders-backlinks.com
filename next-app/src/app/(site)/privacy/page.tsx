/**
 * @file `/privacy`: what is stored, what is sent where, and who can see it.
 *
 * Every claim on this page is checkable against the code, and was written by
 * reading it rather than by adapting a template:
 *
 *   - the stored fields come from the four schemas in `src/lib/models`
 *   - "only a SHA-256 hash of the key" comes from `lib/auth/api-key.ts`
 *   - the crawler user agent is the literal string in `lib/analyze/fetch-html.ts`
 *   - the OpenRouter and VerifiedDR disclosures come from `lib/analyze/describe.ts`
 *     and `lib/analyze/verifieddr.ts`, including the detail that the model is never
 *     given the domain
 *   - the masked/revealed boundary comes from `lib/services/mask.ts`
 *
 * Those third-party disclosures are the reason this page exists in a form
 * longer than one paragraph. A member submitting a URL has no way to know that
 * their homepage text reaches an LLM vendor and their domain reaches VerifiedDR
 * unless we say so, and both are genuinely happening.
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
const USER_AGENT = "BuildersBacklinksBot/1.0 (+https://builders-backlinks.com)";

export const metadata: Metadata = {
    title: "Privacy",
    description:
        "What Builders Backlinks stores, what it never stores, which pages it crawls and under what user agent, which third parties " +
        "see your data, and exactly when a partner learns your domain and email.",
    alternates: { canonical: "/privacy" },
};

const SECTIONS = [
    { href: "#short", label: "The short version" },
    { href: "#stored", label: "What we store" },
    { href: "#never", label: "What we never store" },
    { href: "#crawling", label: "Crawling your pages" },
    { href: "#third-parties", label: "Third parties" },
    { href: "#who-sees", label: "Who can see what" },
    { href: "#email", label: "Email and unsubscribing" },
    { href: "#cookies", label: "Cookies and tracking" },
    { href: "#deletion", label: "Deleting your data" },
    { href: "#changes", label: "Changes and contact" },
] as const;

export default function PrivacyPage() {
    return (
        <>
            <SiteHeader />

            <main id="main">
                <PageHeader
                    eyebrow="Privacy notice"
                    title="What we hold, and who else sees it"
                    lede="Submitting a site sends your homepage text to a language model and your domain to VerifiedDR. That is worth knowing before you paste a URL, so this page says it plainly rather than burying it."
                    meta={`Last updated ${LAST_UPDATED}`}>
                    <OnThisPage items={SECTIONS} />
                </PageHeader>

                <div className="mx-auto max-w-3xl px-5 py-14 sm:px-6 sm:py-16">
                    <Callout title="Read this first">
                        This is the current plain-language privacy notice for an early-stage, free service, written by
                        reading our own code rather than by adapting a template. It is not legal advice. If you need
                        advice about your own obligations, get it from a lawyer in your own jurisdiction.
                    </Callout>

                    {/* -------------------------------------------------------
                        Short version
                    ------------------------------------------------------- */}
                    <Section id="short" title="1. The short version">
                        <Prose>
                            <ul>
                                <li>
                                    We hold your email address, the sites you list, and a record of the links you gave
                                    and received.
                                </li>
                                <li>
                                    We never hold your API key in a readable form. Only a SHA-256 hash of it exists on
                                    our side.
                                </li>
                                <li>
                                    We fetch the pages you point us at, with a crawler that says who it is, and nothing
                                    else.
                                </li>
                                <li>
                                    Your homepage text goes to an LLM vendor (OpenRouter) to draft your listing, and
                                    your domain goes to VerifiedDR for a Domain Rating. Those are the only two places
                                    your site data leaves us.
                                </li>
                                <li>
                                    No partner learns your domain or your email until you and they have both accepted a
                                    match. Then they learn both, at once, and that cannot be undone.
                                </li>
                                <li>
                                    We do not sell anything to anyone, and we run no advertising or tracking scripts.
                                </li>
                            </ul>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Stored
                    ------------------------------------------------------- */}
                    <Section id="stored" title="2. What we store">
                        <Prose>
                            <p>
                                <strong>About you.</strong> Your email address, and the account id you share with{" "}
                                <a href="https://nicklaunches.com">nicklaunches.com</a> (the two sites use one account
                                system, so the same person is the same user on both). Exchange data is kept separately
                                from that shared account record, which this service only ever reads.
                            </p>
                            <p>
                                <strong>About each site you list.</strong> The domain and the full URL, the category,
                                the anchor phrases you want to be linked as, the identity-scrubbed description written
                                for you, the Domain Rating and TrueDR and when they were checked, what kind of placement
                                you said you can offer, the review status and any review note, and counters for links
                                given and received.
                            </p>
                            <p>
                                <strong>About matches.</strong> Which two sites were paired, the category, the matching
                                score, whether the pair came from a widened category, the current state, any reason you
                                gave when declining, when it was agreed, and when it expires.
                            </p>
                            <p>
                                <strong>About links.</strong> The page URL you gave, the anchor text we found, whether
                                the link is live, missing or removed, where on the page it sits, its <Code>rel</Code>{" "}
                                attributes, whether it appears sitewide, when we first saw it, when we last checked, and
                                the last plain-language result of that check. Your partner sees this record for the
                                links between the two of you, in both directions.
                            </p>
                            <p>
                                <strong>About your key.</strong> A SHA-256 hash of it, when it was issued, and when it
                                was last used. The last-used stamp is telemetry so we can spot a key that has gone quiet
                                or gone wrong.
                            </p>
                            <p>
                                <strong>About your preferences.</strong> Your digest cadence, when the last digest was
                                sent, and whether you have unsubscribed. Also two timestamps recording whether we have
                                asked you to launch on nicklaunches.com and whether you did, which is how we measure
                                whether the two products help each other at all.
                            </p>
                            <p>
                                Server logs from our host retain the ordinary request metadata (IP address, user agent,
                                timestamps) for a short period. We do not build member profiles from them.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Never stored
                    ------------------------------------------------------- */}
                    <Section id="never" title="3. What we never store">
                        <Prose>
                            <ul>
                                <li>
                                    <strong>Your plaintext API key.</strong> When a key is created we compute its
                                    SHA-256 hash, store that, and show you the key exactly once. There is no copy of the
                                    original anywhere on our side, so we cannot email it to you, read it out, or hand it
                                    to anyone who asks, including anyone who compromises our database.
                                </li>
                                <li>
                                    <strong>Payment details.</strong> The service is free and takes no payments, so
                                    there is nothing to store.
                                </li>
                                <li>
                                    <strong>Passwords.</strong> Sign-in is handled by the shared account system using
                                    GitHub or Google, so no password reaches this service.
                                </li>
                                <li>
                                    <strong>The raw HTML of your pages.</strong> We fetch a page, read what we need from
                                    it, and keep the result (a description, or a verification record), not the document.
                                </li>
                            </ul>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Crawling
                    ------------------------------------------------------- */}
                    <Section id="crawling" title="4. Crawling your pages">
                        <Prose>
                            <p>
                                We only fetch pages you have pointed us at: the homepage of a site you submit, and the
                                page URL you give when you mark a link placed. We do not crawl your site generally, and
                                we do not follow links off it, with one exception noted below.
                            </p>
                            <p>Our crawler identifies itself:</p>
                            <ul>
                                <li>
                                    User agent: <Code>{USER_AGENT}</Code>
                                </li>
                                <li>Ordinary public HTTP or HTTPS GET requests, with an eight second timeout.</li>
                                <li>
                                    We refuse to fetch anything that resolves to a private or internal network address,
                                    stop reading after about 1.5 MB, and only accept HTML.
                                </li>
                                <li>
                                    When you mark a link placed we may also fetch up to three other pages on the same
                                    site, purely to work out whether the placement is sitewide. That is the exception.
                                </li>
                                <li>
                                    A live link is rechecked at day 7, day 30, and monthly after that, for as long as
                                    the exchange runs.
                                </li>
                            </ul>
                            <p>
                                We read server-rendered HTML only. If your page builds its content with JavaScript, your
                                link can be genuinely present and still invisible to us, which is why an unverifiable
                                link is recorded as inconclusive rather than missing.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Third parties
                    ------------------------------------------------------- */}
                    <Section id="third-parties" title="5. Third parties that see your data">
                        <Prose>
                            <p>Four, and no others.</p>
                        </Prose>

                        <Callout title="OpenRouter: your homepage text is sent to a language model">
                            <p>
                                When you submit a site, we extract text from its homepage (the title, meta description,
                                headings and a sample of the body copy) and send that to{" "}
                                <a
                                    href="https://openrouter.ai"
                                    className="text-accent underline decoration-from-font underline-offset-[3px]">
                                    OpenRouter
                                </a>
                                , which routes it to a language model that drafts your category, description and anchor
                                suggestions. OpenRouter and the underlying model provider handle that text under their
                                own terms.
                            </p>
                            <p>
                                Your domain and your URLs are deliberately kept out of that request. The model is asked
                                to describe a site it is never told the identity of, which is both a privacy measure and
                                the only reliable way to get a description that does not name you.
                            </p>
                        </Callout>

                        <Callout title="VerifiedDR: your domain is sent for a Domain Rating">
                            <p>
                                We send your domain to
                                <a
                                    href="https://verifieddr.com"
                                    rel="noopener nofollow"
                                    className="text-accent underline decoration-from-font underline-offset-[3px]">
                                    VerifiedDR
                                </a>
                                to look up its Ahrefs Domain Rating and their own TrueDR, both scored 0 to 100. Your
                                domain is the only thing sent: no page content, no email, nothing about you. If the
                                lookup fails, the scores are simply unknown and your submission carries on.
                            </p>
                        </Callout>

                        <Prose className="mt-6">
                            <p>
                                <strong>Amazon SES</strong> sends our email, so your address passes through it in order
                                to reach you. <strong>MongoDB</strong> stores the data described above, and the
                                application runs on <strong>Vercel</strong>, which means both hold it on our behalf as
                                infrastructure providers.
                            </p>
                            <p>
                                We do not sell, rent or share member data with anyone else, and there is no advertising
                                network, data broker or analytics vendor in the picture. If that ever changes, it will
                                be on this page before it happens, and members will be emailed.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Who sees what
                    ------------------------------------------------------- */}
                    <Section id="who-sees" title="6. Who can see what">
                        <Prose>
                            <p>This is the part that makes the product work, so it is worth being precise about.</p>
                            <p>
                                <strong>Before a mutual accept,</strong> a potential partner (and any anonymous caller
                                of the search tool) can see what your site is about, its category, its Domain Rating,
                                the anchors you want, what placement you can offer, and how many links you have given
                                and received. They cannot see your domain, your URL, your email address, or your name.
                                Those fields are not withheld by convention; they are absent from the data structure
                                that read paths are able to build at all.
                            </p>
                            <p>
                                <strong>At the moment you both accept,</strong> each of you receives the other domain,
                                URL and email address, simultaneously. This is how you talk directly, and it is
                                deliberately a one-way door: there is no un-reveal, and a partner who has your domain
                                and email keeps them. Only accept a match you are actually willing to trade with.
                            </p>
                            <p>
                                <strong>After a link is placed,</strong> your partner sees the page URL, the anchor
                                text, the placement, the <Code>rel</Code>, and whether the link is still live at each
                                recheck. So do you, for their side. Symmetry is the point: disclosure in both directions
                                is what replaces refereeing.
                            </p>
                            <p>
                                <strong>Treat your listing text as public.</strong> Your description, anchors and DR are
                                readable by anyone who calls the search tool without a key, which is intentional (it
                                lets somebody see whether the exchange is worth joining before handing anything over).
                                Do not put anything in your description that you would not publish.
                            </p>
                            <p>
                                We will disclose data to a third party outside all of this only if we are legally
                                required to, and we will tell you unless we are legally forbidden from telling you.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Email
                    ------------------------------------------------------- */}
                    <Section id="email" title="7. Email and unsubscribing">
                        <Prose>
                            <p>
                                We only email you about your own account: things like a match waiting on you, a partner
                                who accepted, or a link that stopped resolving, plus a periodic digest of what is
                                available in your category. You can set that digest to weekly, every other week, or off.
                                There is no newsletter and no marketing list.
                            </p>
                            <p>
                                Every email has an unsubscribe link. Unsubscribing stops the email, drops your sites out
                                of matching, and disables your API key, all of which are reversible by resubscribing.
                                Nothing is deleted by unsubscribing; see the next section for that.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Cookies
                    ------------------------------------------------------- */}
                    <Section id="cookies" title="8. Cookies and tracking">
                        <Prose>
                            <p>One cookie, for your sign-in session, scoped to this domain. That is the whole list.</p>
                            <p>
                                There is no analytics script, no advertising pixel, no session recorder and no
                                cross-site tracker on this site. The MCP server sets no cookies at all: it authenticates
                                with a bearer token and nothing else.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Deletion
                    ------------------------------------------------------- */}
                    <Section id="deletion" title="9. Deleting your data">
                        <Prose>
                            <p>
                                Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> and ask. We will delete your member
                                record, your sites, your matches and your link records, and confirm when it is done. You
                                can also ask for a copy of everything we hold about you, or for something to be
                                corrected. There is no form and no fee.
                            </p>
                            <p>Two honest limits on what deletion can reach:</p>
                            <ul>
                                <li>
                                    <strong>
                                        Links already published on someone else&rsquo;s website are theirs, not ours.
                                    </strong>{" "}
                                    We can forget that a link existed. We cannot remove it from a site we do not
                                    control. Ask the site owner directly.
                                </li>
                                <li>
                                    <strong>A reveal cannot be recalled.</strong> Any partner you accepted a match with
                                    already has your domain and email address. Deleting our copy does not delete theirs.
                                </li>
                            </ul>
                            <p>
                                Your shared nicklaunches.com account is a separate thing and is not deleted by this
                                request unless you ask for that too. Backups roll off on their own within a short
                                window.
                            </p>
                        </Prose>
                    </Section>

                    {/* -------------------------------------------------------
                        Changes and contact
                    ------------------------------------------------------- */}
                    <Section id="changes" title="10. Changes and contact">
                        <Prose>
                            <p>
                                When this notice changes, the date at the top changes with it. If we ever start sending
                                your data somewhere new, that goes on this page before it starts, and members get an
                                email about it.
                            </p>
                            <p>
                                Questions, requests, corrections, or a security or privacy problem you have found: email{" "}
                                <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. A real person reads it, and we would rather
                                hear about a flaw from you than from anyone else.
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
