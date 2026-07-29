/**
 * @file Client-safe labels for the placement-offer enum.
 *
 * `PlacementOffer` is derived from the pgEnum in the schema, and importing that
 * module into a client component would pull the database layer into the browser
 * bundle. The `import type` below is erased at build time, so this file carries
 * the labels while the `Record<PlacementOffer, ...>` still fails to compile the
 * moment someone adds a new offer to the enum without giving it words here.
 *
 * The server never trusts these values: `commitSite` re-checks the submitted
 * string against the real enum and falls back to "unsure".
 */
import type { PlacementOffer } from "@/lib/exchange";

/** Order shown in the radio group. Broadest offer first, "unsure" last. */
const ORDER = ["blog_post", "existing_article", "resources_page", "unsure"] as const;

const COPY: Record<PlacementOffer, { label: string; hint: string }> = {
    blog_post: {
        label: "A mention in a new post",
        hint: "You are willing to write something and work the link into it.",
    },
    existing_article: {
        label: "A link inside an existing article",
        hint: "You have pages already ranking and can edit one of them.",
    },
    resources_page: {
        label: "A slot on a resources or tools page",
        hint: "You keep a links, tools, or stack page and can add a row.",
    },
    unsure: {
        label: "Not sure yet",
        hint: "Decide once you see who you are matched with. This is a fine answer.",
    },
};

export type PlacementOption = { value: PlacementOffer; label: string; hint: string };

export const PLACEMENT_OPTIONS: readonly PlacementOption[] = ORDER.map((value) => ({
    value,
    label: COPY[value].label,
    hint: COPY[value].hint,
}));

/** The default selection, matching the model default. */
export const DEFAULT_PLACEMENT: PlacementOffer = "unsure";
