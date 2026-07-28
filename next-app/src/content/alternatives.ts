/**
 * @file Competitor comparison content, one entry per alternative.
 *
 * This is the single source for three surfaces: the /alternatives index, each
 * /alternatives/<slug> page, and the footer row. Driving all three from one
 * array is what stops the footer advertising a page that does not exist, which
 * is the exact failure this content set was created to avoid.
 *
 * RULES FOR EDITING, and they are not optional.
 *
 * 1. Every factual claim about another company must be verifiable on THEIR
 *    site. `checkedAt` records when someone last did that. Third-party
 *    listicles do not count: most of that space is affiliate content copying
 *    itself, and it is wrong often enough to be useless as a source.
 * 2. If something cannot be verified, leave it out. Do not infer it, and do not
 *    soften a guess into a hedge. "Not published" is a fine thing to write.
 * 3. `goodAt` is mandatory and must be real. A comparison page that cannot say
 *    what a competitor is better at is not a comparison, it is an advert, and
 *    any reader who has used the product will notice immediately.
 * 4. These pages must have substance. Our own house rules reject thin doorway
 *    pages, and `get_rules` says so to every agent that asks. Publishing a pile
 *    of thin stubs would break the standard the whole product is sold on. Fewer
 *    good pages beat more empty ones.
 */

/** How a link actually gets arranged on a given platform. */
export type Mechanic =
    /** Matched by email digest, identities masked until both sides agree. */
    | "blind digest"
    /** Sign in, browse listings, message the owner. */
    | "marketplace"
    /** Earn credits by giving links, spend them to receive. Non-reciprocal. */
    | "credit ledger"
    /** Money changes hands for a placement. */
    | "paid placements"
    /** Not an exchange: you supply an expert quote and may get cited. */
    | "source matching";

export type Alternative = {
    slug: string;
    name: string;
    /** Their canonical URL. Rendered with rel="nofollow noopener noreferrer". */
    url: string;
    /** One sentence, close to how they describe themselves. */
    oneLiner: string;
    mechanic: Mechanic;
    /** Real numbers where published, otherwise say it is not published. */
    pricing: string;
    /** Manual review, automated, or none, and how long it takes. */
    vetting: string;
    /** Whether the platform checks an agreed link actually went live, and whether it keeps checking. */
    verifies: string;
    audience: string;
    /** Numbered steps, in their flow, not ours. */
    howItWorks: readonly string[];
    /** Genuine strengths. Mandatory. See rule 3 above. */
    goodAt: readonly string[];
    /** Where we differ. `them` and `us` must both be factual. */
    differences: readonly { label: string; them: string; us: string }[];
    /** Honest reasons a reader should choose them over us. */
    pickThemIf: readonly string[];
    pickUsIf: readonly string[];
    /** ISO date the claims above were last checked against their site. */
    checkedAt: string;
    /** Anything a reader needs up front: adjacent category, looks dormant, and so on. */
    note?: string;
};

/**
 * Ordered roughly by how directly each competes: closest analogues first, the
 * adjacent categories last.
 *
 * A note on the wording of every `verifies` field. Where a platform does not
 * publish something, this says so, rather than asserting the thing does not
 * exist. "No recheck schedule is published" is true and checkable. "They never
 * recheck" is a claim about their internals that nobody outside the company can
 * make. The distinction is the whole difference between a comparison page that
 * holds up and one that gets a correction request.
 */
export const ALTERNATIVES: readonly Alternative[] = [
    {
        slug: "ranking-raccoon",
        name: "Ranking Raccoon",
        url: "https://www.rankingraccoon.com",
        oneLiner:
            "A manually moderated community where marketers browse vetted sites in their niche and message the owner to arrange a swap.",
        mechanic: "marketplace",
        pricing: "Free tier can receive messages only. Pro is $25 a month and unlocks browsing and starting chats.",
        vetting: "Manual review of every site, including LinkedIn identity checks. Turnaround is not published.",
        verifies:
            "Yes, once. When a partner confirms a placement it checks the link is live and dofollow. No recheck schedule is published.",
        audience: "In-house marketers, SEO specialists, agencies and freelancers, across 54 niches.",
        howItWorks: [
            "Submit your site and wait for a human moderator to review it against published criteria: metrics, traffic, content quality, niche relevance and identity.",
            "Once approved, browse the database of vetted sites in your industry from a dashboard.",
            "Start a chat with a site owner and make a link request directly.",
            "When you agree, confirm the link in the platform, and it checks the placement is live and dofollow.",
        ],
        goodAt: [
            "It is the only platform in this comparison that publishes its own funnel numbers: 71% of link requests get a reply within a week, and 35% become published links. Publishing the number that makes you look worst is a good sign.",
            "Manual moderation with a specific, published checklist, including LinkedIn identity verification. That is real work and it shows in the quality of the pool.",
            "It enforces against ghosting. Members who repeatedly ignore requests get suspended, and cards show a last-active date. Ghosting is the failure mode that kills most exchanges.",
            "It checks dofollow status automatically, which most of the field does not claim to do at all.",
            "A large, established community with genuine niche coverage, which matters more than any feature when you need a partner today.",
        ],
        differences: [
            {
                label: "Placing the link",
                them: "You agree in chat, then go and edit your own site by hand.",
                us: "Your coding agent reads the brief, writes the link into the right page in your repository, and reports it back.",
            },
            {
                label: "Verification",
                them: "Checked once, when a partner confirms the placement.",
                us: "Checked on placement, then again at day 7, day 30, and monthly. If a link comes down later, both sides are told.",
            },
            {
                label: "Placement policy",
                them: "Dofollow is checked. No published policy on content versus footer placement.",
                us: "Both are classified and shown to both parties. Neither is rejected: where the link goes is your call.",
            },
            { label: "Cost", them: "$25 a month to browse and start conversations.", us: "Free." },
        ],
        pickThemIf: [
            "You want a large vetted pool you can browse today, and you are happy to pay $25 a month for it.",
            "You value a human having looked at every site, and identity verification behind each profile.",
            "You do not work in a code editor, so an agent placing the link for you is worth nothing to you.",
            "You want to negotiate the specifics in a conversation before committing.",
        ],
        pickUsIf: [
            "You live in Claude Code, Cursor or a similar agent, and want the link written into your repository rather than added by hand later.",
            "You want to know your partner's link is still up in three months, not just on the day it went in.",
            "You want to see exactly what you received, in content or in a footer, dofollow or not, without the platform refusing placements on your behalf.",
        ],
        checkedAt: "2026-07-28",
    },
    {
        slug: "rankchase",
        name: "RankChase",
        url: "https://www.rankchase.com",
        oneLiner:
            "Submit your domain, it works out your niche and metrics, and it emails you matched link opportunities.",
        mechanic: "blind digest",
        pricing: "Free tier joins the matching list but cannot see match details. Premium is $19 a month per website.",
        vetting:
            "Automated: authority verification, spam filtering and domain health checks, including flagging high authority paired with low traffic. Community flagging is listed as not yet shipped.",
        verifies:
            "Not published. The dashboard is described as showing live link placements, but no check is described anywhere.",
        audience: "Small and niche businesses, and link building agencies.",
        howItWorks: [
            "Submit your domains to join the matching list.",
            "It extracts your niche, Domain Rating and traffic automatically.",
            "Matched opportunities arrive by email, usually within 24 to 48 hours of joining.",
            "On the free tier you are told you have a match but cannot see who it is. Premium reveals the details and URLs.",
            "Send an exchange request from the dashboard, including ABC style multi-party swaps on Premium.",
        ],
        goodAt: [
            "The cheapest paid tier in this comparison at $19 a month per website, with genuine agency discounts for bulk domains.",
            "Fastest published time to a first match, at 24 to 48 hours, and matches are pushed to you rather than requiring you to browse.",
            "Real matching controls at the paid tier: Domain Rating and traffic filters, custom keyword and niche matching, and TLD control, which nobody else in this comparison advertises.",
            "Flagging high Domain Rating against low organic traffic is a specific, sensible anti-manipulation heuristic rather than a vague quality promise.",
            "Visibly the most actively maintained site of the group.",
        ],
        differences: [
            {
                label: "Placing the link",
                them: "You get matched, then arrange and place the link yourself.",
                us: "Your agent places it in your repository as part of the same conversation.",
            },
            {
                label: "Verification",
                them: "No check is described on their site.",
                us: "Checked on placement, then day 7, day 30, and monthly, with both sides notified if it disappears.",
            },
            {
                label: "Seeing your match",
                them: "The free tier tells you a match exists but hides who it is until you pay.",
                us: "Free. Partners are masked until you both accept, then fully revealed to each other.",
            },
            { label: "Cost", them: "$19 a month per website for usable access.", us: "Free, with no per-site charge." },
        ],
        pickThemIf: [
            "You want matches pushed to your inbox with no browsing, and you would rather not think about it again.",
            "You are running many domains and want per-domain pricing with bulk discounts.",
            "You want fine-grained control over the Domain Rating band, keywords and TLDs you get matched against.",
        ],
        pickUsIf: [
            "You want the placement step handled rather than just the introduction.",
            "You want the platform to keep checking the link over time, not only to introduce you.",
            "You do not want to pay per website to find out who you matched with.",
        ],
        checkedAt: "2026-07-28",
    },
    {
        slug: "swap-backlink",
        name: "Swap Backlink",
        url: "https://www.swapbacklink.com",
        oneLiner:
            "List your site with its live SEO metrics, browse niche-relevant partners, and message them inside the platform.",
        mechanic: "marketplace",
        pricing:
            "Free tier adds one website a month and can receive messages. Pro is $39 a month for five websites and unlimited messaging. Agency pricing is custom.",
        vetting:
            "Light. It surfaces Domain Authority, Page Authority, traffic and spam score and lets you judge. No approval step or review timeline is described.",
        verifies:
            "They state every link is manually verified and visible in your dashboard. What that involves, and whether it repeats, is not published.",
        audience: "Website owners, SEO professionals, agencies, publishers and affiliate marketers.",
        howItWorks: [
            "List your website, which is shown alongside its live SEO metrics.",
            "Browse and filter other listed sites by niche and metrics.",
            "Message an owner inside the platform to propose a swap, including ABC style indirect exchanges.",
            "Decline or skip anything you do not want, which they state explicitly as a user right.",
        ],
        goodAt: [
            "The free tier is genuinely usable for inbound: you can list a site, see every other site, and receive messages without paying.",
            "Full metric transparency before you contact anyone. You see Domain Authority, Page Authority, spam score and traffic up front, so nothing is a blind commitment.",
            "Explicit support for ABC and indirect exchanges, which avoids the reciprocal footprint that a straight one-for-one swap creates.",
            "It states plainly that you can decline or skip any request, which is a small thing that makes a marketplace much less stressful to use.",
        ],
        differences: [
            {
                label: "Placing the link",
                them: "Agreed in chat, then placed by hand.",
                us: "Placed by your agent, in your repository, from the link brief.",
            },
            {
                label: "Verification",
                them: "Described as manual verification. The mechanism and cadence are not published.",
                us: "Automated on placement, then day 7, day 30 and monthly, with the placement type and rel disclosed to both sides.",
            },
            {
                label: "Quality control",
                them: "Metrics are shown and you decide. No described gatekeeping.",
                us: "Every new site is reviewed before it goes active.",
            },
            { label: "Cost", them: "$39 a month for unlimited messaging.", us: "Free." },
        ],
        pickThemIf: [
            "You want to see full third-party metrics on a partner before you ever speak to them.",
            "You specifically want ABC exchanges arranged through conversation.",
            "You are content to judge quality yourself rather than have a platform screen it.",
        ],
        pickUsIf: [
            "You want the placement written for you rather than arranged and then done manually.",
            "You want verification you can actually inspect: which page, which anchor, in content or in a footer, dofollow or not.",
            "You would rather sites were screened before they reach you.",
        ],
        checkedAt: "2026-07-28",
        note: "Their marketing site was still leading with a Black Friday discount code when we last checked in July 2026, and the footer reads 2025. The product works and we are not suggesting otherwise, but check the current price before relying on the one advertised.",
    },
    {
        slug: "linkrocket",
        name: "LinkRocket",
        url: "https://linkrocket.ai",
        oneLiner:
            "A broad SEO suite whose Backlink Exchange is credit based: earn credits by placing links for others, spend them to receive.",
        mechanic: "credit ledger",
        pricing:
            "The exchange is free to join. The surrounding suite, LinkRocket Pro, is $59 a month after a 14 day trial. Credit prices and marketplace placement prices are not published.",
        vetting:
            "Ownership verification before joining, plus checks on Domain Rating, Domain Authority, spam score and niche fit. A reputation system downgrades members who place low quality links or remove them.",
        verifies:
            "Yes, and it is the strongest claim in this comparison: it states it crawls both sides of a placement to confirm links go live and stay live. No cadence or schedule is published.",
        audience: "SEOs, marketers and agencies who want one tool for rank tracking, audits, content and links.",
        howItWorks: [
            "Verify ownership of your site, which is checked for Domain Rating, spam score and niche fit before it joins the exchange.",
            "Place a link for another member and earn credits, weighted by your site's authority, the quality of the page and content relevance.",
            "Spend credits to have links placed for your own sites, from different members than the ones you linked to.",
            "Links flow between multiple parties rather than in reciprocal pairs.",
        ],
        goodAt: [
            "The credit ledger genuinely removes the reciprocal footprint. Links flow between different parties rather than in pairs, which is a real structural argument and not just positioning.",
            "It makes the strongest published link persistence claim of anyone here: crawling both sides to confirm links go live and stay live, backed by a reputation penalty for removing a link. Credit where it is due, this is the closest thing to our own recheck loop.",
            "Ownership verification before joining is a meaningful anti-fraud step that several competitors skip.",
            "If you already want rank tracking, site audits, keyword research and AI visibility monitoring, the exchange comes bundled with a tool you would be buying anyway.",
        ],
        differences: [
            {
                label: "What it is",
                them: "A full SEO suite. The exchange is one feature inside it.",
                us: "Only the exchange, and nothing else.",
            },
            {
                label: "Placing the link",
                them: "You place links for other members yourself to earn credits.",
                us: "Your agent places them, in your repository, from the brief.",
            },
            {
                label: "Reciprocity",
                them: "Credit ledger, so links flow between multiple parties.",
                us: "One for one, reciprocal, matched inside your category. Their model has the better footprint here.",
            },
            {
                label: "Verification detail",
                them: "Confirms links go live and stay live. No published cadence.",
                us: "Day 7, day 30, then monthly, with placement type and rel disclosed to both sides.",
            },
        ],
        pickThemIf: [
            "You want one subscription covering rank tracking, audits, content and links rather than a single-purpose tool.",
            "You specifically want a non-reciprocal credit model, which is the better answer to Google's stance on excessive link exchange than any one-for-one swap, including ours.",
            "You are comfortable earning credits by doing placement work for other people.",
        ],
        pickUsIf: [
            "You want a free, single-purpose exchange rather than a suite subscription.",
            "You want the placement automated in your own repository instead of doing it to earn credits.",
            "You want a published recheck schedule rather than an unspecified promise that links stay live.",
        ],
        checkedAt: "2026-07-28",
        note: "LinkRocket is not primarily a backlink exchange. It is a broad SEO platform that contains both a credit-based exchange and a separate paid marketplace. Compare the exchange, not the suite.",
    },
    {
        slug: "arvow",
        name: "Arvow",
        url: "https://arvow.com",
        oneLiner:
            "An AI SEO writing platform whose backlink exchange places links automatically inside content the network publishes.",
        mechanic: "marketplace",
        pricing:
            "The exchange is not sold separately and is not in the $39 Solo plan. The cheapest route to it is the Business plan at $69 a month.",
        vetting:
            "Automated thresholds for domain authority, real organic traffic and content quality, stated as excluding PBNs and link farms. The actual thresholds are not published.",
        verifies: "Not published for the exchange. No live check or monitoring claim was found.",
        audience: "Marketers and agencies who want content production, autoblogging and links from one tool.",
        howItWorks: [
            "Connect your site to the Arvow backlink network.",
            "Its algorithm finds relevant sites in your niche with similar domain ratings.",
            "Links are placed automatically inside relevant content published across the network, with no outreach or messaging.",
            "Throughput depends on how much relevant content the network is publishing, which they state as roughly a couple of backlinks a week.",
        ],
        goodAt: [
            "By far the lowest human effort of anything here. No browsing, no messaging, no negotiation, and no ghosting, because there is nobody to ghost you.",
            "It publishes a placement quality policy that most competitors do not: links go contextually inside relevant content, explicitly not in footers or sidebars, with anchor text variation.",
            "It solves the supply problem structurally. Because the platform is already generating and publishing articles for members, there is a continuous stream of real content for links to go into.",
            "If you want content production and links from one subscription, nothing else in this comparison does both.",
        ],
        differences: [
            {
                label: "Where links go",
                them: "Into content the network publishes, chosen by their algorithm.",
                us: "Into your own site, on a page you pick, in a sentence your agent writes in your voice.",
            },
            {
                label: "Control",
                them: "Automatic. Very little to decide.",
                us: "You accept each match and choose the page and the anchor yourself.",
            },
            {
                label: "Verification",
                them: "No check published for the exchange.",
                us: "Checked on placement and rechecked on a published schedule.",
            },
            { label: "Cost", them: "$69 a month minimum, since the exchange is not in the entry plan.", us: "Free." },
        ],
        pickThemIf: [
            "You want links with essentially no ongoing involvement, and automation matters more to you than control.",
            "You are already buying AI content production and would rather have both in one subscription.",
            "You do not maintain a site you can easily add a link to yourself.",
        ],
        pickUsIf: [
            "You want to choose the page and write the sentence, because a link inside content you actually wrote is worth more to the person receiving it.",
            "You want the exchange to be free and single-purpose.",
            "You want the placement verified and rechecked rather than trusted.",
        ],
        checkedAt: "2026-07-28",
        note: "Arvow is an AI SEO writing platform, not an exchange company. The backlink exchange is one feature inside it, and it also sells a separate done-for-you niche-edit service that is not an exchange at all.",
    },
    {
        slug: "exchange-backlinks",
        name: "Exchange Backlinks",
        url: "https://exchange-backlinks.com",
        oneLiner: "A free, blind weekly digest for B2B sites: your URL stays hidden until both sides agree to swap.",
        mechanic: "blind digest",
        pricing: "Free forever. No paid tier exists.",
        vetting:
            "Stated as house rules rather than a described process. Real sites only, same niche or nothing, one for one. No reviewer, threshold or turnaround is published.",
        verifies: "No. The product ends at the introduction, and says so plainly.",
        audience: "B2B SaaS and B2B content sites. The niche list is entirely B2B.",
        howItWorks: [
            "Submit your domain and the B2B niche you publish in. Your URL stays hidden.",
            "Once a week you get one email with sites matched to your niche, described by profile only, URLs still hidden.",
            "If both sides agree, the URLs are revealed and you talk directly.",
            "From there, in their words, how and where each link lands is entirely up to the two of you.",
        ],
        goodAt: [
            "The blind match is the best idea in this whole category, and we copied it. Hiding URLs until mutual consent removes both the pre-judging and the inbound spam that make open directories tiring to use.",
            "Deliberately broad niche buckets, which is the right call for liquidity: wider buckets mean more members per niche, so a weekly match is more likely to find anyone at all.",
            "Genuinely zero friction. One email field, no account, no dashboard to learn.",
            "It is open source, so you can read exactly what it does rather than trust a marketing page. Very few products in this space can say that.",
            "The positioning is honest about its own limits. It never claims to verify anything, because it does not.",
        ],
        differences: [
            {
                label: "Audience",
                them: "B2B SaaS and B2B content sites.",
                us: "Indie builders and small SaaS, matched on product categories rather than blog verticals.",
            },
            {
                label: "Placing the link",
                them: "Introduction only. You both go and edit your sites by hand.",
                us: "Your agent writes it into your repository from the brief.",
            },
            {
                label: "Verification",
                them: "None, by design.",
                us: "Checked on placement, then day 7, day 30 and monthly, with the result shown to both sides.",
            },
            {
                label: "Interface",
                them: "Email. There is no app to log into, which is a feature.",
                us: "An MCP server, plus a web fallback.",
            },
        ],
        pickThemIf: [
            "You run a B2B content site rather than a product, which is precisely who they built it for.",
            "You want the absolute minimum: one form, one weekly email, nothing to manage.",
            "You do not use a coding agent, so most of what we add is irrelevant to you.",
        ],
        pickUsIf: [
            "You want the link actually placed and then verified, rather than an introduction and good luck.",
            "You build products rather than write B2B blog content.",
            "You want to know months later whether the link you traded for is still there.",
        ],
        checkedAt: "2026-07-28",
        note: "Full disclosure: this is the open-source project builders-backlinks.com was modelled on, and the blind-match mechanic here is theirs. We think it is a good product. It is also very new, and the per-niche member counts on their homepage are hardcoded values in their public source rather than live figures, so treat those numbers as illustration rather than membership.",
    },
    {
        slug: "outrank",
        name: "Outrank",
        url: "https://www.outrank.so",
        oneLiner:
            "A content automation platform whose credit-based exchange inserts your link into articles other members publish.",
        mechanic: "credit ledger",
        pricing: "$99 a month. The exchange is included in every subscription and cannot be bought separately.",
        vetting:
            "No manual review is described. The network is gated by being paying customers, and placements are matched by automated relevance analysis.",
        verifies:
            "Yes, and with teeth: it states verification checks run regularly, and if a link or its host article is removed, that is detected and credits are adjusted. The cadence is not published.",
        audience:
            "Small businesses, solo founders, affiliate and niche site builders, and agencies running content at volume.",
        howItWorks: [
            "Enable Backlink Exchange in your dashboard settings to join the network.",
            "Host links for other members inside articles the platform writes for you, which earns credits. Higher Domain Rating earns more credits per link, and credits reset daily.",
            "Spend credits to have your link inserted into other members' articles, matched on topical relevance.",
            "Links go inside the article text, which they state explicitly is not footers or sidebars.",
        ],
        goodAt: [
            "It is the only competitor we found that closes the same loop we do: arrange, place, and then keep checking. It goes further than most by tying the check to a consequence, clawing back credits when a link disappears. Credit where it is due.",
            "Weighting credits by Domain Rating is sound market design. Higher authority hosts earn more per link, which is the correct incentive rather than a flat rate.",
            "A published in-content-only placement policy, stated up front rather than buried.",
            "Zero effort by construction. There is no counterparty to negotiate with and nobody who can ghost you.",
        ],
        differences: [
            {
                label: "Whose site the link is on",
                them: "Inside articles the platform generates for other members.",
                us: "On your own site, on a page you choose, in a sentence your agent writes in your voice.",
            },
            {
                label: "Reciprocity",
                them: "Credit ledger, so links flow between multiple parties. Better footprint than ours.",
                us: "One for one, reciprocal, inside your category.",
            },
            {
                label: "What is disclosed",
                them: "Links are monitored and credits adjust. No dofollow or nofollow policy is published.",
                us: "Placement type and rel are both classified and shown to both parties.",
            },
            { label: "Cost", them: "$99 a month, with the exchange bundled in.", us: "Free." },
        ],
        pickThemIf: [
            "You want content production and links from one tool, and you are already paying for AI content anyway.",
            "You want a non-reciprocal credit model, which has a cleaner footprint than a straight swap.",
            "You would rather links appeared with no involvement from you at all.",
        ],
        pickUsIf: [
            "You want links on pages real people actually read on your own site, rather than inside generated articles elsewhere.",
            "You want to know whether what you received is dofollow and whether it sits in content, and to have your partner see the same record.",
            "You do not want to pay $99 a month to trade links.",
        ],
        checkedAt: "2026-07-28",
        note: "There are several products called Outrank. This is outrank.so, which has the backlink exchange. It is not outranking.io, a separate content optimisation tool.",
    },
    {
        slug: "ranklytics",
        name: "Ranklytics",
        url: "https://ranklytics.ai",
        oneLiner:
            "An SEO automation suite that auto-matches your site with peers in its network and coordinates the swap, with an approval step.",
        mechanic: "marketplace",
        pricing:
            "Plans run $49, $99 and $199 a month. Which plan includes the exchange is not published: the pricing page lists Backlink Analysis, which is a different feature.",
        vetting:
            "Stated as automated vetting of every site for domain quality and content standards before admission. Thresholds, reviewer and turnaround are not published.",
        verifies:
            "Live link monitoring appears as a dashboard feature with a status field. No recheck cadence, removal behaviour or remedy is published.",
        audience: "Small businesses, marketing agencies and e-commerce. Not developers.",
        howItWorks: [
            "Connect your site so it can analyse your topics, authority and content into a profile.",
            "It continuously scans the network for sites with matching topics and compatible audience.",
            "You review pending matches before they are confirmed, and can set minimum quality thresholds or exclude domains and categories.",
            "Once confirmed, it coordinates the placement so both sites get an editorial link, with no money involved.",
        ],
        goodAt: [
            "The most honest published position on exchange risk of anyone in this comparison. They address Google's spam policy directly in their own FAQ instead of pretending it does not apply, and link to their own writeup on whether exchanges are safe. That is a fair operator, and it is rarer than it should be.",
            "Real user control rather than full automation: you review pending matches, set quality thresholds, and blocklist domains or categories.",
            "Candid about liquidity. They say volume depends on your niche and network availability rather than promising a number.",
            "Automated topical matching means you are not browsing a directory or writing outreach.",
        ],
        differences: [
            {
                label: "Placing the link",
                them: "It coordinates the placement between the two sites.",
                us: "Your agent writes it into your repository, and you choose the page.",
            },
            {
                label: "Verification detail",
                them: "A live monitoring feature with a status field. No published cadence or removal policy.",
                us: "A published schedule: on placement, day 7, day 30, monthly, and both sides are told if it goes.",
            },
            {
                label: "Getting the exchange",
                them: "Bundled somewhere in a $49 to $199 suite. The pricing page does not say which tier.",
                us: "Free, and it is the only thing we do.",
            },
        ],
        pickThemIf: [
            "You want rank tracking, audits and content generation alongside the exchange.",
            "You want to approve every match against your own quality thresholds before anything happens.",
            "You value an operator that is upfront about the SEO risk rather than one that avoids the topic.",
        ],
        pickUsIf: [
            "You want a single-purpose, free exchange rather than a suite subscription.",
            "You want the recheck schedule written down rather than implied by a dashboard label.",
            "You work in a code editor and want the placement handled there.",
        ],
        checkedAt: "2026-07-28",
    },
    {
        slug: "backlink-ledger",
        name: "BackLink Ledger",
        url: "https://www.backlinkledger.com",
        oneLiner:
            "A free public directory where you list your site with a contact email and other owners email you directly.",
        mechanic: "marketplace",
        pricing:
            "Listing is free. Optional paid placement in the listing order runs from about $3.39 to $12 a month, arranged by email.",
        vetting: "None. Listings go live immediately with no account and no approval.",
        verifies: "No. The platform's involvement ends at displaying your email address.",
        audience:
            "Very mixed and mostly not software. Live listings include local trades, clinics and shops alongside some micro-SaaS.",
        howItWorks: [
            "Fill in a form with your site name, URL, category and a short request. No account needed.",
            "Your listing appears immediately, including a public contact email.",
            "Other site owners browse the directory and email you directly to propose a swap.",
            "Everything after that happens in your inbox, with no involvement from the platform.",
        ],
        goodAt: [
            "Genuinely the lowest friction of anything here. No account, no verification, no wait. You are listed in under a minute.",
            "You can read every listing's actual request and judge fit yourself before contacting anyone, which blind matching cannot offer.",
            "Listing dates are shown, so you can see at a glance whether a listing is stale.",
            "The paid tier is honest about what it sells. It buys position in the list, not link quality, and it is priced at coffee money.",
        ],
        differences: [
            {
                label: "Quality control",
                them: "None. Anyone can list anything instantly.",
                us: "Every site is reviewed before it goes active.",
            },
            {
                label: "Your email",
                them: "Published publicly on the listing.",
                us: "Never shown until you and a partner both accept.",
            },
            {
                label: "After the introduction",
                them: "Nothing. It is your inbox from there.",
                us: "The agent places the link, and we verify and recheck it.",
            },
        ],
        pickThemIf: [
            "You want to be listed in sixty seconds with no account and no screening.",
            "You want to browse and judge every potential partner yourself.",
            "You are outside software, where our category taxonomy would not fit you well anyway.",
        ],
        pickUsIf: [
            "You do not want your email address on a public page.",
            "You want partners screened, matched on category, and banded by authority.",
            "You want any part of the work after the introduction handled for you.",
        ],
        checkedAt: "2026-07-28",
    },
    {
        slug: "collaborator",
        name: "Collaborator",
        url: "https://collaborator.pro",
        oneLiner:
            "A large paid marketplace where you buy a placement on one of tens of thousands of vetted sites, with escrow.",
        mechanic: "paid placements",
        pricing:
            "Per placement, set by the publisher. Observed examples run roughly $40 to $91 an article. Optional insurance costs 10% of the placement price.",
        vetting:
            "Manual moderation, with traffic verified through Ahrefs, Moz, Majestic, Serpstat and Google Analytics. They reserve the right to refuse any site.",
        verifies:
            "Yes, and it is the strongest guarantee in this comparison: you approve the published post before funds release, every placement gets three months of free deletion protection, and paid insurance actively monitors for deletion or non-indexing for twelve months.",
        audience: "SEO teams, PR professionals and agencies with a budget. Not indie makers.",
        howItWorks: [
            "Create a project and filter a catalogue of tens of thousands of sites and Telegram channels by metrics, geography and niche.",
            "Add a site to your cart, describe the task, and send it to the publisher. Funds are held in escrow.",
            "The publisher writes and publishes, with article moderation stated at no more than 30 minutes.",
            "You inspect the published post and approve it, which releases the funds. Approval is automatic after 72 hours.",
        ],
        goodAt: [
            "Scale nothing else here approaches: tens of thousands of sites, with traffic verified through analytics access rather than self-reported metrics.",
            "By far the best buyer protection. Escrow, publisher ratings, free three-month deletion protection, and an insurance option that actively monitors and pays out or refunds if it cannot fix a problem.",
            "It is completely honest that you are buying a placement, which is a cleaner deal than a swap dressed up as a favour.",
            "If you need a specific authority, geography or language this week, it will have inventory and we will not.",
        ],
        differences: [
            {
                label: "The deal",
                them: "You pay money for a placement. It is not an exchange.",
                us: "You trade a link for a link. No money involved in either direction.",
            },
            {
                label: "Whose site",
                them: "A third-party publisher's site, chosen from a catalogue.",
                us: "A peer's site, matched to your category, with a link going back to them.",
            },
            {
                label: "Guarantees",
                them: "Escrow, deletion protection and paid insurance with a remediation SLA. Stronger than ours.",
                us: "Verification and rechecks, with disclosure to both parties. No money is at stake, so there is nothing to insure.",
            },
        ],
        pickThemIf: [
            "You have a budget and want to choose exactly which site, in which country, at which authority.",
            "You need volume and a specific timeline, which no free exchange can promise.",
            "You want contractual protection on a placement, which is only possible when money changed hands.",
        ],
        pickUsIf: [
            "You do not want to pay for links, whether for cost or for principle.",
            "You would rather trade with a peer who is building something similar than buy space on a stranger's site.",
            "You want the placement written into your own repository by your agent.",
        ],
        checkedAt: "2026-07-28",
        note: "Collaborator is a paid marketplace, not an exchange. We list it because people compare the two when deciding how to get links, not because it works the same way.",
    },
    {
        slug: "haro",
        name: "HARO",
        url: "https://www.helpareporter.com",
        oneLiner:
            "A free daily email of journalist queries. You pitch your expertise, and if a reporter uses you they often link you.",
        mechanic: "source matching",
        pricing: "Free for both journalists and sources, funded by newsletter advertising.",
        vetting:
            "Trust and safety rather than site quality: AI-generated content detection, masked emails, community reporting and lifetime bans. There is no site vetting, because you are a source rather than a site.",
        verifies:
            "No. Its involvement ends when you email the journalist. There is no tracking, confirmation or recourse.",
        audience:
            "Founders, PR professionals, consultants, academics and non-profits, plus journalists on the other side.",
        howItWorks: [
            "A journalist submits a query describing the expert they need and a deadline.",
            "Registered sources get up to three email digests a day, Monday to Friday, with all active queries.",
            "You scan the queries and pitch your expertise directly by email.",
            "If the journalist selects you and publishes, you are credited, often with a link back.",
        ],
        goodAt: [
            "A link earned from an editorial citation on a real publication is worth more than any exchanged link, on every measure. That is not close, and we are not going to pretend otherwise.",
            "Reach nothing in this category approaches: they report over 800,000 registered sources and 75,000 journalists, free, with eighteen years of name recognition.",
            "The 2025 return to a plain free email was a real simplification, and the anti-AI-content safeguards address the exact problem that made the late Cision era unusable.",
            "No counterparty obligation. You never owe anyone a link.",
        ],
        differences: [
            {
                label: "What you are doing",
                them: "Pitching expertise and hoping a journalist picks you. Not an exchange.",
                us: "Trading a link for a link with a peer, with both sides committed.",
            },
            {
                label: "Certainty",
                them: "None. You can pitch a hundred queries and get nothing.",
                us: "A match either becomes an agreed trade or it does not, and you know which.",
            },
            {
                label: "Link quality",
                them: "Potentially excellent. A real editorial citation on a real publication.",
                us: "A relevant link from a peer's site. Honestly, a weaker link than a good HARO placement.",
            },
            {
                label: "Effort",
                them: "Daily reading and writing pitches, ongoing.",
                us: "One instruction to your agent.",
            },
        ],
        pickThemIf: [
            "You can write well about your field and can spend time on pitches most days.",
            "You want the highest quality links available and are willing to accept that most pitches go nowhere.",
            "You want media coverage rather than links specifically.",
        ],
        pickUsIf: [
            "You want a predictable outcome rather than a lottery with good odds of nothing.",
            "You do not have time to read a daily digest and write pitches.",
            "You want the link verified and rechecked rather than hoping you spot the mention.",
        ],
        checkedAt: "2026-07-28",
        note: "HARO is not a link exchange, and its history confuses people. Cision shut its Connectively rebrand down permanently in December 2024. Featured.com acquired HARO in April 2025 and restored the free email model, so the version running today is a revival under new ownership. Anyone telling you HARO is dead is a year out of date.",
    },
];

export function alternativeBySlug(slug: string): Alternative | undefined {
    return ALTERNATIVES.find((entry) => entry.slug === slug);
}
