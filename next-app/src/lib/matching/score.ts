import { MATCH_GROUPS, UNMATCHABLE } from "@/lib/categories";
import type { Category } from "@/lib/categories";
import type { MatchableSite, ScoreBreakdown, ScoreCandidate } from "@/lib/contracts";

/**
 * @file Pair scoring for the exchange. Pure: no database, no network.
 *
 * The reference implementation this replaces sorted candidates by Domain Rating
 * descending and took the first one. That single line is its biggest quality
 * problem, and it churns both ends of the range at once: the DR 70 owner is
 * shown to every DR 4 site that joins and leaves feeling farmed, while the DR 4
 * owner only ever meets partners who will never accept. Nobody in the middle
 * gets a look in either.
 *
 * So the correction here is deliberate: high DR is not a goal, DR *proximity*
 * is. {@link DR_BAND_MAX} is the second heaviest term in the function, behind
 * only category, and a raw DR value never appears in the total on its own.
 *
 * Everything is a plain function over plain objects because the same code runs
 * in two places: the synchronous auto-pair on `submit_site`, and the weekly
 * cron. Two callers, one code path. If matching needed a database connection
 * the instant path would have quietly grown its own cheaper variant by now.
 */

/**
 * Same category on both sides.
 *
 * The single largest term, and intentionally so: topical relevance is the only
 * thing that makes a reciprocal link defensible to a search engine or to a
 * human looking at the two pages. A pair that is perfect on every other axis
 * and wrong on topic is still a bad link, so nothing else is allowed to
 * out-vote it. 40 keeps an exact-category pair ahead of an adjacent one even
 * when the adjacent one wins every remaining category outright.
 */
export const CATEGORY_EXACT = 40;

/**
 * Neighbouring category from {@link MATCH_GROUPS}.
 *
 * Worth real points but only about a third of an exact match. This is the
 * cold-start release valve: a member alone in their category gets a plausible
 * partner instead of an empty digest and a reason never to open the next one.
 * The 25 point drop from {@link CATEGORY_EXACT} means widening never
 * out-competes a genuine same-category partner that actually exists.
 */
export const CATEGORY_ADJACENT = 15;

/**
 * Maximum awarded for a tight DR band.
 *
 * Second heaviest term in the function. Big enough that a well banded adjacent
 * pair can beat a badly banded exact-category pair on the remaining terms,
 * which is the behaviour we want: a DR 12 site is genuinely better served by a
 * DR 14 neighbour than by a DR 78 site in its own category, because the second
 * pairing will simply never be accepted.
 */
export const DR_BAND_MAX = 25;

/**
 * DR gap that is treated as roughly free at the bottom of the range.
 *
 * Half of {@link DR_BAND_MAX} is still awarded at exactly this gap. 8 points of
 * DR is about the width of one honest peer group among new indie sites (a DR 3
 * and a DR 11 site will happily trade), and it is deliberately not larger:
 * below DR 20 each point of DR is a meaningful difference in authority.
 */
export const DR_BAND_BASE_TOLERANCE = 8;

/**
 * How much the tolerance widens with the pair's average DR.
 *
 * DR is a compressed scale: the distance from 0 to 10 is a far bigger real gap
 * than 70 to 80, so a fixed tolerance would unfairly punish established sites
 * for ordinary variation. At mean DR 75 the tolerance becomes 8 + 18.75, which
 * scores a 70/80 pair almost identically to a 20/25 pair. That symmetry is the
 * point: "well banded" should mean the same thing everywhere on the scale.
 */
export const DR_BAND_TOLERANCE_SCALE = 0.25;

/**
 * DR assumed for a site whose rating is unknown.
 *
 * A null DR means the lookup failed or has not run, not that the site is
 * worthless, so treating null as 0 would dump every unrated site into the
 * bottom band and pair them only with each other. 15 is roughly the median for
 * an indie maker site with a little history, and it is deliberately not the
 * 0..100 midpoint of 50: pretending an unknown is a DR 50 would systematically
 * push unrated sites at the strongest members, which is the exact spam problem
 * this module exists to fix.
 */
export const ASSUMED_DR_FOR_UNRATED = 15;

/**
 * Ceiling on DR band fit when either side's DR is assumed rather than measured.
 *
 * An unrated site is not penalised, but it does not get to claim a *confirmed*
 * perfect band either, otherwise two unrated sites would score higher on this
 * axis than two real, measured, closely banded sites. 18 of 25 says "probably
 * fine, we just do not know yet".
 */
export const DR_BAND_ASSUMED_CEILING = 18;

/**
 * Maximum awarded for shared anchor keywords.
 *
 * A tie-breaker rather than a driver. Keywords are self-reported anchor hints,
 * so they are the softest evidence in the whole function and easy to game by
 * stuffing 25 popular phrases into the field. 15 is enough to separate two
 * otherwise equal candidates by genuine topical closeness, and not enough for
 * keyword stuffing to buy a match on its own.
 */
export const KEYWORD_MAX = 15;

/**
 * Both sides named a concrete placement.
 *
 * Mismatched expectations (one side is writing a blog post, the other quietly
 * adds a footer link) is what kills most agreed exchanges, so two members who
 * have both already decided what they can offer are much more likely to finish.
 * Note that the two offers do not have to be the *same* type: a blog post
 * traded for a resources page listing is a completely normal, honest exchange,
 * and requiring symmetry here would thin the pool for no benefit.
 */
export const PLACEMENT_BOTH_CONCRETE = 10;

/**
 * Exactly one side said "unsure".
 *
 * Still workable, since the decided side usually anchors what happens, but it
 * is measurably more likely to stall. Worth less than half of
 * {@link PLACEMENT_BOTH_CONCRETE} rather than zero.
 */
export const PLACEMENT_ONE_UNSURE = 4;

/**
 * Both sides said "unsure".
 *
 * No signal at all, so no points. Explicitly not a penalty: "unsure" is an
 * honest answer from someone new and we asked the question optionally.
 */
export const PLACEMENT_BOTH_UNSURE = 0;

/**
 * Maximum for a candidate who reliably gives links back.
 *
 * Givers surface, takers sink. This is the only term that reflects behaviour
 * rather than static profile data, and it is what stops the exchange filling up
 * with people collecting links and never placing any.
 */
export const RECIPROCITY_MAX = 10;

/**
 * Score for a candidate with no history at all (0 given, 0 got).
 *
 * Neutral, never a penalty. A brand new member has a `linksGiven / linksGot`
 * ratio of 0/0 and the naive reading of that is "gives nothing", which is
 * exactly backwards: someone has to go first, and if joining puts you at the
 * bottom of every queue then nobody ever gets a first match and the whole
 * exchange fails to start. Mid-scale is the honest answer for "unknown".
 */
export const RECIPROCITY_NEUTRAL = 5;

/**
 * Score for a candidate who has given back exactly as much as they received.
 *
 * Deliberately above {@link RECIPROCITY_NEUTRAL}: a proven even trader is
 * better company than an unknown. The remaining headroom up to
 * {@link RECIPROCITY_MAX} is reserved for net givers, so there is still
 * something to earn by placing a link before you are asked.
 */
export const RECIPROCITY_BALANCED = 7;

/**
 * Give/get ratio at which a candidate is treated as a fully proven giver.
 *
 * Twice as many given as received. Beyond this the score is capped, because we
 * want to surface generous members, not run a leaderboard that rewards
 * grinding the ratio ever higher.
 */
export const RECIPROCITY_GENEROUS_RATIO = 2;

/**
 * Maximum for a member who has been waiting a long time (or forever).
 *
 * Rotation money. Without it the same five well-profiled members get matched
 * with each other week after week while everyone else watches, which is how a
 * small exchange feels dead while technically working. 10 is enough to break a
 * near tie in favour of the quieter member and never enough to override
 * category or band.
 */
export const STALENESS_MAX = 10;

/**
 * Days since the last match at which staleness is worth full points.
 *
 * 30 days lines up with the weekly cron: a member who has sat out roughly four
 * cycles has waited long enough to be pushed to the front of the queue.
 */
export const STALENESS_FULL_DAYS = 30;

/**
 * The pair has been matched before.
 *
 * Large enough to sink an already-matched candidate below any fresh one worth
 * having (it wipes out an exact-category match and then some), but deliberately
 * a penalty and not an exclusion. In a thin category the choice is often
 * "re-match a known good partner" or "send nothing", and sending nothing is
 * worse: a repeat pair still produces a link, an empty digest produces an
 * unsubscribe. Callers who genuinely must not repeat should filter their own
 * candidate list.
 */
export const PENALTY_ALREADY_MATCHED = -50;

/**
 * The candidate declined this subject before.
 *
 * Smaller than {@link PENALTY_ALREADY_MATCHED} because a decline is often
 * circumstantial (bad week, wrong moment) rather than a verdict on the pairing,
 * and profiles change. Enough to push them well down the list, not enough to
 * erase them permanently.
 */
export const PENALTY_RECENTLY_DECLINED = -30;

/**
 * The candidate came from a widened (adjacent category) pool.
 *
 * A tie-break nudge on top of the 25 point gap already created by
 * {@link CATEGORY_ADJACENT}, expressing "if a same-category partner exists at
 * all, take them". Applied only to candidates that are genuinely off-category:
 * a same-category site that happens to be sitting in a widened pool did nothing
 * wrong and is exactly who we wanted to find.
 */
export const PENALTY_WIDENED = -10;

/**
 * Total used for a rejected pair.
 *
 * Zero rather than -Infinity on purpose. Breakdowns are persisted and cross
 * JSON boundaries on the way to MCP tools and web routes, and `JSON.stringify`
 * turns -Infinity into `null`, which then fails schema validation somewhere far
 * away from here. `rejected` is the field callers must read; the total is only
 * ever a display number. {@link findBestPartner} filters on `rejected`, never
 * on the total.
 */
export const REJECTED_TOTAL = 0;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Keeps totals stable across runs so identical inputs always sort identically. */
function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * True when two categories are neighbours in {@link MATCH_GROUPS}.
 *
 * Checked in both directions on purpose. The map is documented as "symmetric in
 * spirit" but is not literally symmetric (Sustainability lists Lifestyle;
 * Lifestyle does not list Sustainability back), and those gaps read as
 * omissions rather than as rules. Since an exchange is a mutual link, treating
 * adjacency as one-way would silently deny the sparser side of every asymmetric
 * entry a partner, which is the cold-start failure we are trying to avoid.
 */
function areAdjacent(a: Category, b: Category): boolean {
    return (MATCH_GROUPS[a]?.includes(b) ?? false) || (MATCH_GROUPS[b]?.includes(a) ?? false);
}

/**
 * Scores how well two Domain Ratings sit in the same band.
 *
 * Peaks when the gap is small and decays smoothly as it widens, with a
 * tolerance that grows with the pair's average DR so the same "closeness" means
 * the same thing at the top and the bottom of the scale. A null rating is
 * substituted with {@link ASSUMED_DR_FOR_UNRATED} and the result capped at
 * {@link DR_BAND_ASSUMED_CEILING}.
 */
function scoreDrBand(subjectDr: number | null, candidateDr: number | null): number {
    const a = subjectDr ?? ASSUMED_DR_FOR_UNRATED;
    const b = candidateDr ?? ASSUMED_DR_FOR_UNRATED;
    const gap = Math.abs(a - b);
    const mean = (a + b) / 2;
    const tolerance = DR_BAND_BASE_TOLERANCE + mean * DR_BAND_TOLERANCE_SCALE;
    const ratio = gap / tolerance;
    // Lorentzian falloff: full marks at gap 0, half marks at gap === tolerance,
    // long thin tail after that. Chosen over a linear ramp so that "close" is
    // rewarded generously while "far" collapses fast, which is what actually
    // predicts an accept.
    const fit = DR_BAND_MAX / (1 + ratio * ratio);
    const ceiling = subjectDr === null || candidateDr === null ? DR_BAND_ASSUMED_CEILING : DR_BAND_MAX;
    return Math.min(fit, ceiling);
}

/** Lowercases, trims and de-duplicates an anchor keyword list. */
function normalizeKeywords(keywords: readonly string[]): Set<string> {
    const out = new Set<string>();
    for (const raw of keywords) {
        const value = raw.trim().toLowerCase().replace(/\s+/g, " ");
        if (value.length > 0) out.add(value);
    }
    return out;
}

/**
 * Scores shared anchor keywords as the mean of Jaccard and coverage.
 *
 * Jaccard alone punishes a site for listing many keywords, so a thorough
 * 25-keyword profile would score worse than a lazy 3-keyword one. Coverage
 * (shared over the smaller set) alone does the opposite and hands a perfect
 * score to any single-keyword site that matches anything. Averaging the two
 * cancels both pathologies: a small focused site fully covered by a larger one
 * still scores well, while padding the list dilutes as fast as it adds.
 */
function scoreKeywordOverlap(subjectKeywords: readonly string[], candidateKeywords: readonly string[]): number {
    const a = normalizeKeywords(subjectKeywords);
    const b = normalizeKeywords(candidateKeywords);
    if (a.size === 0 || b.size === 0) return 0;

    let shared = 0;
    for (const value of a) {
        if (b.has(value)) shared += 1;
    }
    if (shared === 0) return 0;

    const union = a.size + b.size - shared;
    const jaccard = shared / union;
    const coverage = shared / Math.min(a.size, b.size);
    return KEYWORD_MAX * ((jaccard + coverage) / 2);
}

/** Scores how compatible the two sides' offered placements are. */
function scorePlacementFit(subject: MatchableSite, candidate: MatchableSite): number {
    const subjectUnsure = subject.placementOffered === "unsure";
    const candidateUnsure = candidate.placementOffered === "unsure";
    if (!subjectUnsure && !candidateUnsure) return PLACEMENT_BOTH_CONCRETE;
    if (subjectUnsure && candidateUnsure) return PLACEMENT_BOTH_UNSURE;
    return PLACEMENT_ONE_UNSURE;
}

/**
 * Scores a candidate's give/get behaviour.
 *
 * Returns {@link RECIPROCITY_NEUTRAL} for a member with no history at all, so
 * that joining is never itself a handicap.
 */
function scoreReciprocityHealth(candidate: MatchableSite): number {
    const given = Math.max(0, candidate.linksGiven);
    const got = Math.max(0, candidate.linksGot);
    if (given === 0 && got === 0) return RECIPROCITY_NEUTRAL;

    const ratio = given / Math.max(got, 1);
    if (ratio <= 1) return RECIPROCITY_BALANCED * ratio;

    const generosity = Math.min(1, (ratio - 1) / (RECIPROCITY_GENEROUS_RATIO - 1));
    return RECIPROCITY_BALANCED + (RECIPROCITY_MAX - RECIPROCITY_BALANCED) * generosity;
}

/**
 * Scores how long a candidate has been waiting for a match.
 *
 * A site that has never been matched gets the full bonus: those are precisely
 * the members most likely to conclude the exchange does not work and leave.
 */
function scoreStaleness(candidate: MatchableSite, now: Date): number {
    if (candidate.lastMatchedAt === null) return STALENESS_MAX;
    const days = (now.getTime() - candidate.lastMatchedAt.getTime()) / MS_PER_DAY;
    if (!Number.isFinite(days) || days <= 0) return 0;
    return STALENESS_MAX * Math.min(1, days / STALENESS_FULL_DAYS);
}

/** A rejected breakdown with every component zeroed, so nothing reads as a partial score. */
function rejectedBreakdown(reason: NonNullable<ScoreBreakdown["rejected"]>): ScoreBreakdown {
    return {
        total: REJECTED_TOTAL,
        category: 0,
        drBand: 0,
        keywordOverlap: 0,
        placementFit: 0,
        reciprocityHealth: 0,
        staleness: 0,
        penalties: 0,
        rejected: reason,
    };
}

/**
 * Scores one candidate as a partner for one subject.
 *
 * Pure and total: same inputs always produce the same breakdown, and it never
 * throws. A pair that must not be matched comes back with `rejected` set and
 * every component at zero rather than as a very low score, because "must not"
 * and "would rather not" are different questions and callers need to be able to
 * tell them apart.
 *
 * @param subject - The site we are finding a partner for.
 * @param ctx - Match history, pool widening flag and the current time.
 * @returns A full breakdown. Read `rejected` before trusting `total`.
 */
export const scoreCandidate: ScoreCandidate = (subject, candidate, ctx): ScoreBreakdown => {
    // A site is never its own partner, and one owner cannot trade with
    // themselves: self-dealing across two owned domains is the cheapest way to
    // farm links out of an exchange like this.
    if (candidate.id === subject.id || candidate.ownerId === subject.ownerId) {
        return rejectedBreakdown("same_owner");
    }
    if (UNMATCHABLE.includes(subject.category) || UNMATCHABLE.includes(candidate.category)) {
        return rejectedBreakdown("unmatchable_category");
    }

    const exact = subject.category === candidate.category;
    const adjacent = !exact && areAdjacent(subject.category, candidate.category);
    if (!exact && !adjacent) {
        return rejectedBreakdown("no_category_overlap");
    }

    const category = exact ? CATEGORY_EXACT : CATEGORY_ADJACENT;
    // Band on TrueDR where we have it, falling back to DR. TrueDR discounts
    // manipulated authority, and banding is the lever someone would game by
    // inflating DR, so the score it trusts must be the harder one to inflate.
    // The fallback keeps a site with no TrueDR matchable rather than dropping
    // it, and keeps every existing test in this file meaningful.
    const drBand = round2(
        scoreDrBand(subject.trueDr ?? subject.domainRating, candidate.trueDr ?? candidate.domainRating),
    );
    const keywordOverlap = round2(scoreKeywordOverlap(subject.keywords, candidate.keywords));
    const placementFit = round2(scorePlacementFit(subject, candidate));
    const reciprocityHealth = round2(scoreReciprocityHealth(candidate));
    const staleness = round2(scoreStaleness(candidate, ctx.now));

    let penalties = 0;
    if (ctx.alreadyMatched.has(candidate.id)) penalties += PENALTY_ALREADY_MATCHED;
    if (ctx.previouslyDeclined.has(candidate.id)) penalties += PENALTY_RECENTLY_DECLINED;
    if (ctx.widened && !exact) penalties += PENALTY_WIDENED;

    const total = round2(category + drBand + keywordOverlap + placementFit + reciprocityHealth + staleness + penalties);

    return {
        total,
        category,
        drBand,
        keywordOverlap,
        placementFit,
        reciprocityHealth,
        staleness,
        penalties,
        rejected: null,
    };
};
