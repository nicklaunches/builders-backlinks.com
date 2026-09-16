import { z } from "zod";

import { REPO_API_URL, REPO_URL } from "@/content/links";
import { errorDetail } from "@/lib/log";

/**
 * @file The star count in the header, and the one call that fetches it.
 *
 * THE BADGE RENDERS WITHOUT A NUMBER RATHER THAN NOT AT ALL. GitHub being slow,
 * rate-limiting us or moving the repo must never be able to break the bar on
 * every page of the product, so every failure path here ends in a link that
 * still says what it is.
 *
 * TWO CACHES, and the second is the one that matters. `revalidate` is the right
 * instruction and is honoured wherever a data cache exists, but this app ships
 * on workerd through OpenNext with a bare config and no incremental cache
 * configured, so it cannot be relied on: without the module-level cache below,
 * a header that renders on every request would mean a GitHub call on every
 * request, and unauthenticated GitHub allows sixty an hour PER IP — which for a
 * Worker is an IP shared with everyone else on that colo.
 *
 * The module-level value is a per-isolate cache of a public number. Nothing
 * request-scoped and nothing about a member may ever go in it: that is the rule
 * that makes mutable module state safe here and nowhere else.
 */

/** How long a fetched count is served before we ask again. */
const TTL_MS = 60 * 60 * 1000;

/** The shape we need out of the repository payload. Anything else is ignored. */
const Repo = z.object({ stargazers_count: z.number().int().nonnegative() });

let cached: { at: number; stars: number | null } | null = null;

/**
 * The repository's star count, or null when we do not have one.
 *
 * A failed call keeps serving the last good number rather than blanking the
 * badge, and still resets the clock: a repository that is down, renamed or
 * rate-limiting us gets asked once an hour, not once a request.
 */
async function starCount(): Promise<number | null> {
    if (cached && Date.now() - cached.at < TTL_MS) return cached.stars;

    const previous = cached?.stars ?? null;
    try {
        const response = await fetch(REPO_API_URL, {
            headers: { accept: "application/vnd.github+json", "user-agent": "builders-backlinks.com" },
            next: { revalidate: 3600 },
        });
        if (!response.ok) throw new Error(`GitHub answered ${response.status}`);

        const parsed = Repo.safeParse(await response.json());
        if (!parsed.success) throw new Error("GitHub answered in a shape we do not recognise");

        cached = { at: Date.now(), stars: parsed.data.stargazers_count };
    } catch (err) {
        console.error("github stars: could not read the count", errorDetail(err));
        cached = { at: Date.now(), stars: previous };
    }
    return cached.stars;
}

/** 1240 becomes 1.2k. Thousands are the only place this product will ever get to. */
function formatCount(stars: number): string {
    if (stars < 1000) return String(stars);
    const thousands = stars / 1000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1)}k`;
}

/** The GitHub mark. Inline rather than from an icon set, which drops brand marks. */
function GitHubMark() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="shrink-0">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
    );
}

/** The bordered pill in the header: the mark, and the count when we have one. */
export async function GitHubStars() {
    const stars = await starCount();

    return (
        <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={stars === null ? "This project on GitHub" : `Star this project on GitHub, ${stars} stars`}
            className="border-line text-muted hover:border-line-strong hover:bg-surface-2 hover:text-fg inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 transition-colors">
            <GitHubMark />
            {stars === null ? null : (
                <span className="text-fg font-mono text-[12px] font-medium">{formatCount(stars)}</span>
            )}
        </a>
    );
}
