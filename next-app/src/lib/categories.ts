/**
 * @file Category taxonomy for the exchange.
 *
 * Deliberately identical to `SUGGESTED_CATEGORIES` in the Nick Launches app
 * (`src/lib/products/constants.ts`). Keeping the two lists byte-identical is
 * what makes the NL product import a zero-mapping copy of `categories[0]`, and
 * the list is already tuned to indie maker products.
 */

export const CATEGORIES = [
    "AI",
    "Analytics",
    "CMS",
    "Communication",
    "Content Creation",
    "Data",
    "Design Tools",
    "Developer Tools",
    "DevOps",
    "E-Commerce",
    "Education",
    "Finance",
    "Food & Drink",
    "Gaming",
    "Health & Fitness",
    "HR & Recruiting",
    "Image",
    "Jobs & Careers",
    "Launch Platforms",
    "Legal",
    "Lifestyle",
    "Marketing",
    "Monitoring",
    "Music",
    "No Code",
    "Open Source",
    "Productivity",
    "Sales",
    "Search",
    "Security",
    "SEO",
    "Social Media",
    "Sustainability",
    "Travel",
    "Video",
    "Web3",
    "Writing",
    "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
    return (CATEGORIES as readonly string[]).includes(value);
}

/**
 * Categories that are never matched, in either direction.
 *
 * "Other" is a bucket, not a topic. Matching inside it is matching at random,
 * which produces exactly the off-topic pairs that make a link exchange look
 * like a link scheme. Sites landing here are asked to pick again at review.
 */
export const UNMATCHABLE: readonly Category[] = ["Other"];

/**
 * Adjacency map used to widen a thin category's candidate pool by one step.
 *
 * The cold-start failure mode of the reference implementation is a member in a
 * category with no other members, who receives an empty digest and never opens
 * another. Rather than send nothing, matching falls back to these neighbours
 * once a category has fewer than `WIDEN_BELOW` active sites.
 *
 * Adjacency is intentionally conservative and symmetric in spirit: a link from
 * an adjacent category should still read as editorially reasonable to a human
 * looking at the two pages. Anything looser and the relevance argument that
 * keeps these links defensible stops being true.
 */
export const MATCH_GROUPS: Partial<Record<Category, readonly Category[]>> = {
    AI: ["Developer Tools", "Productivity", "Data"],
    Analytics: ["Data", "Monitoring", "Marketing"],
    CMS: ["No Code", "Content Creation", "Writing"],
    Communication: ["Productivity", "Social Media"],
    "Content Creation": ["Writing", "Video", "Image", "Marketing"],
    Data: ["Analytics", "Developer Tools", "AI"],
    "Design Tools": ["Image", "No Code", "Productivity"],
    "Developer Tools": ["DevOps", "Open Source", "Data", "AI"],
    DevOps: ["Developer Tools", "Monitoring", "Security"],
    "E-Commerce": ["Marketing", "Finance", "Sales"],
    Education: ["Productivity", "Writing"],
    Finance: ["Analytics", "E-Commerce"],
    "Food & Drink": ["Lifestyle", "Health & Fitness"],
    Gaming: ["Video", "Social Media"],
    "Health & Fitness": ["Lifestyle", "Food & Drink"],
    "HR & Recruiting": ["Jobs & Careers", "Productivity"],
    Image: ["Design Tools", "Content Creation", "Video"],
    "Jobs & Careers": ["HR & Recruiting", "Education"],
    "Launch Platforms": ["Marketing", "SEO", "Productivity"],
    Legal: ["Finance", "Productivity"],
    Lifestyle: ["Health & Fitness", "Food & Drink", "Travel"],
    Marketing: ["SEO", "Social Media", "Content Creation", "Analytics"],
    Monitoring: ["DevOps", "Analytics", "Developer Tools"],
    Music: ["Video", "Content Creation"],
    "No Code": ["Developer Tools", "Design Tools", "CMS"],
    "Open Source": ["Developer Tools", "DevOps"],
    Productivity: ["Communication", "AI", "No Code"],
    Sales: ["Marketing", "E-Commerce"],
    Search: ["SEO", "Data", "AI"],
    Security: ["DevOps", "Developer Tools"],
    SEO: ["Marketing", "Content Creation", "Search"],
    "Social Media": ["Marketing", "Communication", "Content Creation"],
    Sustainability: ["Lifestyle"],
    Travel: ["Lifestyle"],
    Video: ["Content Creation", "Image", "Music"],
    Web3: ["Finance", "Developer Tools"],
    Writing: ["Content Creation", "SEO", "Education"],
};

/**
 * Below this many active sites, a category widens into {@link MATCH_GROUPS}.
 *
 * Also the public "open" floor: categories under it are shown as "be first
 * here" rather than as a live pool. Confirmed workable against the Nick
 * Launches product base on 2026-07-27: 19 of 38 categories clear this floor on
 * primary category alone, 36 when any assigned category counts.
 */
export const WIDEN_BELOW = 8;

/**
 * Returns the categories a site in `category` may be matched against, in
 * priority order: always itself first, then neighbours only when the pool is
 * thin. `activeCount` is the number of active sites in `category` itself.
 */
export function candidateCategories(category: Category, activeCount: number): Category[] {
    if (UNMATCHABLE.includes(category)) return [];
    if (activeCount >= WIDEN_BELOW) return [category];
    return [category, ...(MATCH_GROUPS[category] ?? [])];
}
