import { render } from "@react-email/render";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";

import type { MaskedPartner, RevealedPartner } from "@/lib/contracts";
import type { LinkBrief } from "@/lib/services/links";

import { buildUnsubscribeUrl, runWithEmailContext } from "../src/emails/_context";
import { DigestEmail } from "../src/emails/digest";
import { LinkRemovedEmail } from "../src/emails/link-removed";
import { LinkVerifiedEmail } from "../src/emails/link-verified";
import { MatchAgreedEmail } from "../src/emails/match-agreed";
import { MatchExpiredEmail } from "../src/emails/match-expired";
import { MatchProposedEmail } from "../src/emails/match-proposed";
import { MessageReceivedEmail } from "../src/emails/message-received";
import { PlacementPendingEmail } from "../src/emails/placement-pending";
import { SiteApprovedEmail } from "../src/emails/site-approved";
import { SiteRejectedEmail } from "../src/emails/site-rejected";
import { SubmissionReceivedEmail } from "../src/emails/submission-received";
import { WelcomeEmail } from "../src/emails/welcome";

// Set before anything imports a module that reads these at call time. The
// unsubscribe helper signs with AUTH_SECRET and merely warns when it is
// absent, which would render every template with an untokenized link and hide
// the URL shape this script exists to check. A throwaway value here exercises
// the real path without needing a configured environment.
process.env.AUTH_SECRET ??= "render-emails-placeholder-secret";
process.env.NEXT_PUBLIC_SITE_URL ??= "https://builders-backlinks.com";

/**
 * @file Renders every template to `.render/` and enforces the masking boundary.
 *
 * Two jobs, and the second is the important one.
 *
 * 1. EYEBALLING. Email templates cannot be checked by reading them: table
 *    layout, inlined styles, and a plain-text twin that has to stay legible on
 *    its own. Open `.render/index.html` and look at all five.
 *
 * 2. THE MASKING ASSERTION. `match-proposed` and `digest` are sent before
 *    either side has accepted, so they must not contain the partner's domain,
 *    URL, or email address anywhere: not in copy, not in an `href`, not in an
 *    image `src`, and not in the plain-text body either. The prop types already
 *    make it hard (`MaskedPartner` has no such fields), but a template can
 *    still take an extra prop, and email is the one surface where a mistake
 *    cannot be recalled. This is the backstop.
 *
 * The fixtures are built so the assertion has something real to catch: the
 * masked and the revealed partner are the SAME site, so the identity the masked
 * renders must not contain is a string that genuinely exists in this scenario
 * and appears, correctly, in `match-agreed`.
 *
 * Run with `pnpm emails:render`. Exits non-zero on any violation.
 */

const OUT_DIR = path.join(process.cwd(), ".render");

/** The recipient. The only address allowed to appear in any rendered output. */
const RECIPIENT = "member@member-site.test";

/**
 * The partner's real identity in this scenario. Every one of these strings is
 * a failure if it turns up in a masked render.
 */
const PARTNER_DOMAIN = "hidden-partner.test";
const PARTNER_URL = "https://hidden-partner.test/docs/pricing";
const PARTNER_EMAIL = "owner@hidden-partner.test";

/** Hosts a link in any template may legitimately point at. */
const ALLOWED_HOSTS = new Set(["builders-backlinks.com", "your-site.com"]);

const maskedPartner: MaskedPartner = {
    partnerId: "6650f0c4a1b2c3d4e5f60011",
    category: "Developer Tools",
    description:
        "A hosted feature-flag service for small engineering teams: percentage rollouts, per-environment targeting, " +
        "and an SDK for six languages. Aimed at teams too small to run their own flag infrastructure.",
    domainRating: 34,
    wantedAnchors: ["feature flags", "feature flag service", "progressive rollouts", "gradual feature rollout"],
    placementOffered: "existing_article",
    linksGiven: 7,
    linksGot: 5,
};

const secondMaskedPartner: MaskedPartner = {
    partnerId: "6650f0c4a1b2c3d4e5f60022",
    category: "Analytics",
    description:
        "A privacy-first web analytics tool with no cookies and a single script tag. Sells to indie founders who " +
        "want a dashboard they can read in ten seconds.",
    domainRating: null,
    wantedAnchors: ["privacy-first analytics", "cookieless analytics"],
    placementOffered: "blog_post",
    linksGiven: 2,
    linksGot: 2,
};

const thirdMaskedPartner: MaskedPartner = {
    partnerId: "6650f0c4a1b2c3d4e5f60033",
    category: "DevOps",
    description: "A CLI that diffs infrastructure state against what is actually deployed and explains the drift.",
    domainRating: 51,
    wantedAnchors: ["infrastructure drift detection"],
    placementOffered: "resources_page",
    linksGiven: 11,
    linksGot: 14,
};

/** Same site as `maskedPartner`, after both sides accepted. */
const revealedPartner: RevealedPartner = {
    ...maskedPartner,
    domain: PARTNER_DOMAIN,
    url: PARTNER_URL,
    email: PARTNER_EMAIL,
};

const brief: LinkBrief = {
    matchId: "6650f0c4a1b2c3d4e5f6aaaa",
    targetUrl: PARTNER_URL,
    targetDomain: PARTNER_DOMAIN,
    anchorOptions: ["feature flags", "feature flag service", "progressive rollouts"],
    partnerDescription: maskedPartner.description,
    partnerOffers: "existing_article",
    snippet: `<a href="${PARTNER_URL}">feature flags</a>`,
    guidance: [
        "Put it somewhere a reader would genuinely find it useful. A sentence inside an existing, relevant page beats a new page made to hold links.",
        "Write the surrounding sentence in your own voice. A link with real context around it is worth more to both of you than a bare list entry.",
        "Vary the anchor. If everyone uses the same phrase for a site, that pattern is visible and helps nobody.",
        "A footer or sidebar link is allowed and still counts. It is simply worth less, and your partner will see exactly what you gave, as you will see theirs.",
    ],
};

type Fixture = {
    name: string;
    subject: string;
    element: React.ReactElement;
    /** Masked templates are the ones the identity assertion runs against. */
    masked: boolean;
};

const fixtures: Fixture[] = [
    {
        name: "match-proposed",
        subject: "A Developer Tools site is open to trading links",
        masked: true,
        element: createElement(MatchProposedEmail, {
            matchId: "6650f0c4a1b2c3d4e5f6aaaa",
            partner: maskedPartner,
            expiresAt: new Date("2026-08-09T12:00:00Z"),
            widened: false,
        }),
    },
    {
        name: "match-agreed",
        subject: "You are trading links with hidden-partner.test",
        masked: false,
        element: createElement(MatchAgreedEmail, {
            matchId: "6650f0c4a1b2c3d4e5f6aaaa",
            partner: revealedPartner,
            brief,
        }),
    },
    {
        name: "placement-pending",
        subject: "They placed their link, yours is still outstanding",
        masked: false,
        element: createElement(PlacementPendingEmail, {
            matchId: "6650f0c4a1b2c3d4e5f6aaaa",
            partner: revealedPartner,
            targetUrl: PARTNER_URL,
            anchorOptions: brief.anchorOptions,
            partnerPlaced: true,
            expires: "20 Aug 2026",
        }),
    },
    {
        // `masked: true` is the point of this fixture, not an oversight. A match
        // can expire from `proposed`, where the two sides were never revealed,
        // so this template takes no partner at all and the assertion below is
        // what keeps it that way if someone later tries to make it warmer.
        name: "match-expired",
        subject: "A match expired, and you are back in the pool",
        masked: true,
        element: createElement(MatchExpiredEmail, {
            category: "Developer Tools",
            wasAgreed: true,
        }),
    },
    {
        name: "link-verified",
        subject: "Your link is live",
        masked: false,
        element: createElement(LinkVerifiedEmail, {
            direction: "given",
            pageUrl: "https://your-site.com/blog/shipping-faster",
            targetDomain: PARTNER_DOMAIN,
            hostDomain: "your-site.com",
            found: true,
            inconclusive: false,
            placement: "content",
            rel: [],
            anchorText: "feature flags",
            sitewide: false,
            message: "Found in the page content, dofollow, anchor “feature flags”.",
            checkedAt: new Date("2026-07-27T09:14:00Z"),
        }),
    },
    {
        // The other direction, rendered separately because it is the one that
        // was wrong: the heading names the site the link sits ON, which for the
        // beneficiary is the partner, while the fact row names the site it
        // points AT, which is their own. A render where both read the same
        // domain is the bug back.
        name: "link-verified-received",
        subject: "Your partner's link to you is live",
        masked: false,
        element: createElement(LinkVerifiedEmail, {
            direction: "received",
            pageUrl: PARTNER_URL,
            targetDomain: "your-site.com",
            hostDomain: PARTNER_DOMAIN,
            found: true,
            inconclusive: false,
            placement: "content",
            rel: [],
            anchorText: "feature flags",
            sitewide: false,
            message: "Found in the page content, dofollow, anchor “feature flags”.",
            checkedAt: new Date("2026-07-27T09:14:00Z"),
        }),
    },
    {
        /** The backfill's copy. Nothing in the live app renders this variant. */
        name: "link-verified-late",
        subject: "Your partner's link to you is live",
        masked: false,
        element: createElement(LinkVerifiedEmail, {
            direction: "received",
            pageUrl: PARTNER_URL,
            targetDomain: "your-site.com",
            hostDomain: PARTNER_DOMAIN,
            found: true,
            inconclusive: false,
            placement: "content",
            rel: [],
            anchorText: "feature flags",
            sitewide: false,
            message: "Found in the page content, dofollow, anchor “feature flags”.",
            checkedAt: new Date("2026-08-09T11:00:00Z"),
            confirmedLate: { firstSeenAt: new Date("2026-07-12T04:02:00Z") },
        }),
    },
    {
        name: "link-removed",
        subject: "A link came down",
        masked: false,
        element: createElement(LinkRemovedEmail, {
            role: "beneficiary",
            matchId: "6650f0c4a1b2c3d4e5f6aaaa",
            pageUrl: "https://your-site.com/blog/shipping-faster",
            targetDomain: PARTNER_DOMAIN,
            hostDomain: "your-site.com",
            anchorText: "feature flags",
            firstSeenAt: new Date("2026-05-02T10:00:00Z"),
            removedAt: new Date("2026-07-26T04:30:00Z"),
        }),
    },
    {
        name: "digest",
        subject: "3 sites you could trade with this week",
        masked: true,
        element: createElement(DigestEmail, {
            category: "Developer Tools",
            candidates: [maskedPartner, secondMaskedPartner, thirdMaskedPartner],
            widenedCount: 1,
            standingNote: "You give about as much as you get. Matching favours members like you.",
        }),
    },

    // The account and listing lifecycle. All four concern the recipient's OWN
    // site, so there is no partner identity in them to leak and `masked` is
    // false. They are still worth previewing: the rejection copy in particular
    // is the hardest thing in this directory to get the tone of, and reading it
    // rendered is the only way to judge that.
    {
        // Post-agreement only, so the sender's domain in it is correct rather
        // than a leak. It is in this file for the tone: the excerpt is another
        // member's words, quoted, and it has to read as a forwarded reply and
        // not as a notification about one.
        name: "message-received",
        subject: "partner-site.com replied about your link exchange",
        masked: false,
        element: createElement(MessageReceivedEmail, {
            matchId: "1a5f1c62-0d4f-4c3a-9a11-6a0f2b4de111",
            senderDomain: "partner-site.com",
            recipientDomain: "your-site.com",
            excerpt:
                "The CLI overview, thanks — that is the page people actually land on. From my side you would go in the shipping section of an existing guide rather than a links page.",
            truncated: false,
        }),
    },
    {
        name: "welcome",
        subject: "Welcome to the exchange",
        masked: false,
        element: createElement(WelcomeEmail),
    },
    {
        name: "submission-received",
        subject: "We have your-site.com, it is in review",
        masked: false,
        element: createElement(SubmissionReceivedEmail, {
            domain: "your-site.com",
            category: "Developer Tools",
            description:
                "A hosted feature-flag service for small teams, with SDKs for Node, Go and Python and a free tier that does not expire.",
            keywords: ["feature flags", "progressive delivery", "release toggles"],
            domainRating: 34,
            placementOffered: "blog_post",
        }),
    },
    {
        name: "site-approved",
        subject: "your-site.com is live in the exchange",
        masked: false,
        element: createElement(SiteApprovedEmail, {
            domain: "your-site.com",
            category: "Developer Tools",
        }),
    },
    {
        name: "site-rejected",
        subject: "About your submission of your-site.com",
        masked: false,
        element: createElement(SiteRejectedEmail, {
            domain: "your-site.com",
            reason: "The domain resolves to a single page of links out to other sites, with no content of its own. The exchange only lists sites where a link sits next to something worth reading.",
        }),
    },
];

/**
 * Decoded twin of a rendered body.
 *
 * A leak that arrives percent-encoded inside an `href` is still a leak, and a
 * substring search for `hidden-partner.test` would miss `hidden-partner%2Etest`
 * entirely. Searching both forms costs nothing and closes the gap.
 */
function haystack(...bodies: string[]): string {
    return bodies
        .flatMap((body) => {
            let decoded = body;
            try {
                decoded = decodeURIComponent(body.replace(/%(?![0-9a-f]{2})/gi, "%25"));
            } catch {
                // A body that is not valid percent-encoding as a whole is fine;
                // the raw form is still searched.
            }
            return [body, decoded];
        })
        .join("\n");
}

type Violation = { fixture: string; rule: string; detail: string };

/**
 * The masking boundary, checked on rendered output rather than on types.
 *
 * Three independent rules, because each catches a different mistake:
 *
 *   literals   someone passed the identity in through a new prop
 *   hosts      someone added a link, a tracking pixel, or a favicon
 *   addresses  someone put a contact line in a pre-accept template
 *
 * The host rule is the one that would catch a leak nobody thought of, since it
 * inverts the question from "does this contain the secret" to "is every
 * outbound reference one we intended".
 */
function checkMasked(name: string, html: string, text: string): Violation[] {
    const violations: Violation[] = [];
    const body = haystack(html, text);

    for (const literal of [PARTNER_DOMAIN, PARTNER_URL, PARTNER_EMAIL]) {
        if (body.includes(literal)) {
            violations.push({ fixture: name, rule: "partner identity literal", detail: literal });
        }
    }

    for (const match of html.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/gi)) {
        const raw = match[1].trim();
        if (raw.length === 0 || raw.startsWith("#")) continue;
        if (raw.toLowerCase().startsWith("mailto:")) {
            const address = raw.slice("mailto:".length).split("?")[0].toLowerCase();
            if (address !== RECIPIENT) {
                violations.push({ fixture: name, rule: "unexpected mailto", detail: raw });
            }
            continue;
        }
        let host: string;
        try {
            host = new URL(raw, "https://builders-backlinks.com").hostname.replace(/^www\./, "");
        } catch {
            violations.push({ fixture: name, rule: "unparseable url", detail: raw });
            continue;
        }
        if (!ALLOWED_HOSTS.has(host)) {
            violations.push({ fixture: name, rule: "link to a host outside the allowlist", detail: raw });
        }
    }

    for (const match of body.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) {
        const address = match[0].toLowerCase();
        if (address !== RECIPIENT) {
            violations.push({ fixture: name, rule: "email address in a masked template", detail: address });
        }
    }

    return violations;
}

async function main(): Promise<void> {
    await rm(OUT_DIR, { recursive: true, force: true });
    await mkdir(OUT_DIR, { recursive: true });

    const unsubscribeUrl = buildUnsubscribeUrl(process.env.NEXT_PUBLIC_SITE_URL as string, RECIPIENT);
    const violations: Violation[] = [];

    console.log(`Rendering ${fixtures.length} templates to ${path.relative(process.cwd(), OUT_DIR)}/\n`);

    for (const fixture of fixtures) {
        // Rendered through the same context `sendEmail` establishes, so the
        // footer and every origin-derived link are exercised exactly as they
        // would be in a real send.
        const [html, text] = await runWithEmailContext(
            { unsubscribeUrl, siteOrigin: process.env.NEXT_PUBLIC_SITE_URL },
            () => Promise.all([render(fixture.element), render(fixture.element, { plainText: true })]),
        );

        await writeFile(path.join(OUT_DIR, `${fixture.name}.html`), html, "utf8");
        await writeFile(path.join(OUT_DIR, `${fixture.name}.txt`), text, "utf8");

        if (fixture.masked) {
            const found = checkMasked(fixture.name, html, text);
            violations.push(...found);
            console.log(
                `  ${found.length === 0 ? "ok  " : "FAIL"}  ${fixture.name.padEnd(16)}masked, ${found.length} violation(s)`,
            );
        } else {
            console.log(`  ok    ${fixture.name.padEnd(16)}reveals identity by design, not checked`);
        }
    }

    const index = [
        '<!doctype html><meta charset="utf-8"><title>Email previews</title>',
        "<h1>Builders Backlinks email previews</h1><ul>",
        ...fixtures.map(
            (f) =>
                `<li><a href="./${f.name}.html">${f.name}</a> (<a href="./${f.name}.txt">text</a>): ${f.subject}</li>`,
        ),
        "</ul>",
    ].join("\n");
    await writeFile(path.join(OUT_DIR, "index.html"), index, "utf8");

    console.log("\nMasking boundary");
    if (violations.length === 0) {
        console.log(
            `  PASS: no partner domain, url, or email address in ${fixtures.filter((f) => f.masked).length} masked templates`,
        );
        console.log(`  checked literals: ${PARTNER_DOMAIN}, ${PARTNER_URL}, ${PARTNER_EMAIL}`);
        console.log(`  allowed link hosts: ${[...ALLOWED_HOSTS].join(", ")}`);
        return;
    }

    console.error(`  FAIL: ${violations.length} masking violation(s)\n`);
    for (const violation of violations) {
        console.error(`    ${violation.fixture}: ${violation.rule}\n      ${violation.detail}`);
    }
    console.error(
        "\n  A pre-accept template leaked a partner identity. This is the one rule the product rests on:\n" +
            "  fix the template, do not relax the check.",
    );
    process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
