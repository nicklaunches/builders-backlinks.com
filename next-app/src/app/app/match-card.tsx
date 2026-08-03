"use client";

import { AlertTriangle, Check, Copy, Link2, Loader2, X } from "lucide-react";
import { useActionState, useId, useState } from "react";

import {
    type BriefState,
    type PlaceState,
    type RespondState,
    getLinkBriefAction,
    markLinkPlacedAction,
    respondToMatchAction,
} from "@/app/app/actions";
import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";
import { SnippetBody } from "@/components/web/snippet-body";
import { TabList } from "@/components/web/tab-list";

/**
 * @file One match, and everything you can do to it from a browser.
 *
 * TWO THINGS HERE ARE LOAD-BEARING.
 *
 * 1. THE MASKING BOUNDARY. A partner's domain, url and email must not appear
 *    before both sides accept. The ESLint layering rule that guards this for
 *    the MCP handlers does NOT cover `src/app/app/**`, so there is no automated
 *    net under this file. The protection is that the server only ever sends a
 *    `MaskedPartner`, which structurally has no `domain` field, and `revealed`
 *    says which shape arrived. Render identity ONLY inside a `revealed` branch,
 *    and never add a prop that carries a domain in from somewhere else.
 *
 * 2. NEXT STEP IS RE-WORDED. `matches.ts` returns `nextStep` strings written
 *    for agents: "Call get_link_brief for this match, then call
 *    mark_link_placed." Rendering that to a browser user tells them to invoke
 *    tools they are deliberately not using. `uiNextStep` below maps state to
 *    the same meaning in UI terms. It is a mapping and not a rewrite of the
 *    service, because the agent wording is correct for agents.
 */

export type MatchRow = {
    matchId: string;
    state: string;
    /**
     * The PARTNER's category, which is NOT `MatchView.category`. See the
     * mapping in page.tsx for why the two differ on a widened match.
     */
    category: string;
    /**
     * True when the pair came from an adjacent category. Shown rather than left
     * to inference: an unlabelled adjacent match just looks like a wrong one.
     */
    widened: boolean;
    revealed: boolean;
    /** Present only when revealed. The type mirrors what the server sent. */
    partnerDomain: string | null;
    partnerDescription: string;
    partnerDomainRating: number | null;
    partnerOffers: string;
    wantedAnchors: readonly string[];
    expires: string;
    /** True when the viewer has already accepted and is waiting on the other side. */
    waitingOnThem: boolean;
    /** True when the other side accepted first and the ball is here. */
    waitingOnMe: boolean;
};

/** The agent-facing `nextStep`, restated for someone looking at a screen. */
function uiNextStep(row: MatchRow): string {
    switch (row.state) {
        case "proposed":
            return "Neither of you has responded yet. Accept to signal you are in. If they accept too, you are revealed to each other.";
        case "agreed":
            return "Agreed. Get the snippet below, put it on your site, then paste the page URL back here so we can verify it.";
        case "placed":
            return "Both links are live. We recheck at day 7, day 30, then monthly, and tell you both if either comes down.";
        case "declined":
            return "Declined. Nothing further to do.";
        case "expired":
            return "This one expired and both sites went back into the pool.";
        default:
            return row.waitingOnMe
                ? "They have accepted and are waiting on you. Accept to reveal both sides and get the link brief."
                : "You have accepted. Waiting on them.";
    }
}

const RESPOND_INITIAL: RespondState = { status: "idle" };
const BRIEF_INITIAL: BriefState = { status: "idle" };
const PLACE_INITIAL: PlaceState = { status: "idle" };

const FORMATS = [
    { id: "html", label: "HTML" },
    { id: "markdown", label: "Markdown" },
    { id: "mdx", label: "MDX" },
    { id: "jsx", label: "JSX" },
] as const;

export function MatchCard({ row }: { row: MatchRow }) {
    const [respond, respondAction, responding] = useActionState(respondToMatchAction, RESPOND_INITIAL);
    const [declining, setDeclining] = useState(false);

    // Optimistically reflect the decision without refetching the page, matching
    // how the rest of this app avoids revalidatePath.
    const decided = respond.status === "done" && respond.matchId === row.matchId ? respond : null;
    const isAgreed = row.state === "agreed" || row.state === "placed" || (decided?.revealed ?? false);
    const isDeclined = row.state === "declined" || (decided ? !decided.accepted : false);

    const respondError =
        respond.status === "error" && respond.matchId === row.matchId
            ? respond.message
            : respond.status === "signed_out"
              ? "Your session ended. Sign in again and the match will still be here."
              : null;

    return (
        <li className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-[17px] font-semibold">
                    {/* Identity only inside the revealed branch. See rule 1 above. */}
                    {row.revealed && row.partnerDomain ? row.partnerDomain : `A ${row.category} site`}
                </h3>
                <StatePill state={isDeclined ? "declined" : isAgreed ? "agreed" : row.state} />
                <span className="text-muted ml-auto font-mono text-[11.5px] tracking-[0.14em] uppercase">
                    {row.expires}
                </span>
            </div>

            <p className="mt-4 text-[14.5px] leading-relaxed">{row.partnerDescription}</p>

            {/* The "(adjacent)" tag below is a label, not an explanation. Someone
                looking at a partner outside their own category needs the reason
                in the same glance, or the match reads as a mistake.

                Worded from the pair, not from "your category". Only the side
                that initiated the pairing was measured against WIDEN_BELOW, so
                telling the other member their own category was thin is a claim
                we have not checked and is often false. */}
            {row.widened ? (
                <p className="text-muted mt-3 text-[14px] leading-relaxed">
                    One of your two categories was too thin to pair inside it, so we widened by a single adjacent step
                    rather than leave you both unmatched.
                </p>
            ) : null}

            <dl className="border-line mt-5 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-3">
                <Fact label="Category" value={row.widened ? `${row.category} (adjacent)` : row.category} />
                <Fact
                    label="Domain Rating"
                    value={row.partnerDomainRating == null ? "Not measured" : String(row.partnerDomainRating)}
                />
                <Fact label="They offer" value={row.partnerOffers.replace(/_/g, " ")} />
            </dl>

            <p className="text-muted mt-5 text-[14px] leading-relaxed">{uiNextStep(row)}</p>

            {respondError ? <ErrorNote>{respondError}</ErrorNote> : null}

            {/* Accept / decline, only while the match is still open. */}
            {!isAgreed && !isDeclined && row.state !== "expired" ? (
                <form action={respondAction} className="mt-6">
                    <input type="hidden" name="matchId" value={row.matchId} />
                    {declining ? (
                        <DeclineBox onCancel={() => setDeclining(false)} pending={responding} />
                    ) : (
                        <div className="flex flex-wrap gap-3">
                            <button
                                type="submit"
                                name="accept"
                                value="true"
                                disabled={responding}
                                className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center gap-2 rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                                {responding ? (
                                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                                ) : (
                                    <Check aria-hidden="true" className="size-4" />
                                )}
                                {responding ? "Accepting" : row.waitingOnThem ? "Accepted, waiting" : "Accept"}
                            </button>
                            <button
                                type="button"
                                onClick={() => setDeclining(true)}
                                className="border-line hover:border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors">
                                <X aria-hidden="true" className="size-4" />
                                Decline
                            </button>
                        </div>
                    )}
                </form>
            ) : null}

            {isAgreed && !isDeclined ? <AgreedTools row={row} /> : null}
        </li>
    );
}

/** Declining asks for an optional reason, which the other side never sees verbatim. */
function DeclineBox({ onCancel, pending }: { onCancel: () => void; pending: boolean }) {
    const id = useId();
    const [reason, setReason] = useState("");

    return (
        <div className="border-line bg-surface-2/60 rounded-sm border p-5">
            <label htmlFor={id} className="block text-[14px] font-medium">
                Anything worth telling us? Optional.
            </label>
            <p className="text-muted mt-1 text-[13px] leading-relaxed">
                Used to stop matching you on the same mismatch again. Declining is free and costs you nothing in
                standing.
            </p>
            <textarea
                id={id}
                name="reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="border-line bg-bg focus:border-line-strong mt-3 w-full rounded-sm border p-3 text-[14px] leading-relaxed outline-none"
            />
            <div className="mt-4 flex flex-wrap gap-3">
                <button
                    type="submit"
                    name="accept"
                    value="false"
                    disabled={pending}
                    className="border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                    {pending ? (
                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                        <X aria-hidden="true" className="size-4" />
                    )}
                    {pending ? "Declining" : "Decline this match"}
                </button>
                <button
                    type="button"
                    onClick={onCancel}
                    className="border-line hover:border-line-strong hover:bg-surface-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors">
                    Keep it open
                </button>
            </div>
        </div>
    );
}

/** The post-agreement half: fetch a snippet, place it, report the page back. */
function AgreedTools({ row }: { row: MatchRow }) {
    const [brief, briefAction, loadingBrief] = useActionState(getLinkBriefAction, BRIEF_INITIAL);
    const [place, placeAction, placing] = useActionState(markLinkPlacedAction, PLACE_INITIAL);
    const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("html");
    const [pageUrl, setPageUrl] = useState("");
    const [anchor, setAnchor] = useState("");
    const urlId = useId();
    const anchorId = useId();

    const loaded = brief.status === "done" && brief.matchId === row.matchId ? brief.brief : null;
    const briefError = brief.status === "error" && brief.matchId === row.matchId ? brief.message : null;
    const report = place.status === "done" && place.matchId === row.matchId ? place.report : null;
    const placeError = place.status === "error" && place.matchId === row.matchId ? place.message : null;

    return (
        <div className="border-line mt-6 border-t pt-6">
            <h4 className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Your side of the trade</h4>

            {/* Step one: get the snippet. */}
            <form action={briefAction} className="mt-4">
                <input type="hidden" name="matchId" value={row.matchId} />
                <input type="hidden" name="format" value={format} />
                {loaded ? null : (
                    <button
                        type="submit"
                        disabled={loadingBrief}
                        className="border-line hover:border-line-strong hover:bg-surface-2 inline-flex items-center gap-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                        {loadingBrief ? (
                            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        ) : (
                            <Link2 aria-hidden="true" className="size-4" />
                        )}
                        {loadingBrief ? "Building the brief" : "Get the link and snippet"}
                    </button>
                )}
            </form>

            {briefError ? <ErrorNote>{briefError}</ErrorNote> : null}

            {loaded ? (
                <div className="mt-4">
                    <TabList
                        label="Snippet format"
                        idBase={`fmt-${row.matchId}`}
                        items={FORMATS}
                        value={format}
                        onChange={setFormat}
                        variant="page"
                    />
                    <p className="text-muted mt-3 text-[13px] leading-relaxed">
                        Switching format needs a fresh fetch: press the button again after changing it.
                    </p>

                    <div className="border-term-line bg-term-bg mt-4 flex items-center gap-3 rounded-sm border p-3">
                        <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
                            <SnippetBody snippet={loaded.snippet} />
                        </div>
                        <CopyButton value={loaded.snippet} label="link snippet" />
                    </div>

                    <dl className="border-line mt-4 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2">
                        <Fact label="Link to" value={loaded.targetUrl} />
                        <Fact label="Anchors they want" value={loaded.anchorOptions.join(", ") || "Any"} />
                    </dl>

                    <ul className="text-muted mt-4 space-y-2 text-[13.5px] leading-relaxed">
                        {loaded.guidance.map((line) => (
                            <li key={line} className="flex gap-2">
                                <span aria-hidden="true">·</span>
                                <span>{line}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {/* Step two: report where it went, and verify it for real. */}
            {report ? (
                <PlacementResult report={report} />
            ) : (
                <form action={placeAction} className="mt-6">
                    <input type="hidden" name="matchId" value={row.matchId} />
                    <label htmlFor={urlId} className="block text-[14px] font-medium">
                        Where did you put it?
                    </label>
                    <input
                        id={urlId}
                        name="pageUrl"
                        type="url"
                        required
                        placeholder="https://your-site.com/blog/the-post"
                        value={pageUrl}
                        onChange={(event) => setPageUrl(event.target.value)}
                        className="border-line bg-bg focus:border-line-strong mt-2 w-full rounded-sm border p-3 text-[14px] outline-none"
                    />

                    <label htmlFor={anchorId} className="mt-4 block text-[14px] font-medium">
                        Anchor you used. Optional.
                    </label>
                    <input
                        id={anchorId}
                        name="anchorUsed"
                        value={anchor}
                        onChange={(event) => setAnchor(event.target.value)}
                        className="border-line bg-bg focus:border-line-strong mt-2 w-full rounded-sm border p-3 text-[14px] outline-none"
                    />

                    {placeError ? <ErrorNote>{placeError}</ErrorNote> : null}

                    <button
                        type="submit"
                        disabled={placing}
                        className="bg-accent text-accent-fg hover:bg-accent-hover mt-4 inline-flex items-center gap-2 rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                        {placing ? (
                            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        ) : (
                            <Check aria-hidden="true" className="size-4" />
                        )}
                        {placing ? "Fetching your page" : "I placed it, check the page"}
                    </button>

                    {/* The crawl is genuinely slow. Say what is happening rather
                        than spinning, the same way submit-flow narrates drafting. */}
                    {placing ? (
                        <p role="status" aria-live="polite" className="text-muted mt-3 text-[13px] leading-relaxed">
                            Fetching the page, reading the HTML, and working out where the link sits and whether it is
                            dofollow. A few seconds.
                        </p>
                    ) : null}
                </form>
            )}
        </div>
    );
}

/**
 * The three outcomes of a placement check.
 *
 * `inconclusive` is NOT a miss, and must never be phrased as one. A page that
 * renders client-side legitimately looks empty to an HTML fetch, so telling
 * someone their link is missing when the crawler simply could not read the page
 * is the worst thing this screen could do.
 */
function PlacementResult({ report }: { report: { status: string; message: string; inconclusive: boolean } }) {
    const live = report.status === "live";
    return (
        <div
            className={cn(
                "mt-6 rounded-sm border p-5",
                live ? "border-term-ok/40 bg-term-ok/10" : "border-line bg-surface-2/60",
            )}>
            <p className="flex items-start gap-2.5 text-[14px] leading-relaxed">
                {live ? (
                    <Check aria-hidden="true" className="text-term-ok mt-0.5 size-4 shrink-0" />
                ) : (
                    <Copy aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                )}
                <span>{report.message}</span>
            </p>
            {!live && report.inconclusive ? (
                <p className="text-muted mt-3 text-[13px] leading-relaxed">
                    Nothing is wrong yet. We could not read the page, which happens with client-rendered sites, and we
                    will try again on the next scheduled check.
                </p>
            ) : null}
        </div>
    );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
    return (
        <p
            role="alert"
            className="border-line bg-surface-2 mt-5 flex items-start gap-2.5 rounded-sm border p-4 text-[13.5px] leading-relaxed">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{children}</span>
        </p>
    );
}

function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="bg-surface-2/60 p-4">
            <dt className="text-muted font-mono text-[10.5px] tracking-[0.14em] uppercase">{label}</dt>
            <dd className="mt-1 text-[14px] break-words">{value}</dd>
        </div>
    );
}

function StatePill({ state }: { state: string }) {
    const good = state === "agreed" || state === "placed";
    return (
        <span
            className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase",
                good ? "border-term-ok/40 bg-term-ok/10 text-term-ok" : "border-line text-muted bg-surface-2",
            )}>
            {state.replace(/_/g, " ")}
        </span>
    );
}
