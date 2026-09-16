"use client";

import { AlertTriangle, Loader2, SlidersHorizontal } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { type PreferencesState, type SavedPreferences, saveMatchingPreferencesAction } from "@/app/app/sites/actions";
import { cn } from "@/components/web/cn";
import type { SiteStatus } from "@/lib/exchange";
import { MAX_FLOOR, type PoolCurve, admittedAt, mutualAt } from "@/lib/matching/floor";

/**
 * @file One row of `/app/sites`: what the site is, and who it will match with.
 *
 * CLOSED UNTIL ASKED. The floor is set once and then left alone for months, so
 * five listings meant five open forms and a page nobody could scan. What a
 * closed row must still carry is the SETTING, because a floor is invisible by
 * nature: it works by nothing happening. Hence the chip, and hence the one case
 * where it turns accent — a floor that is currently blocking every partner in
 * the pool is the one thing on this page a member needs to find without
 * looking for it.
 *
 * THE NUMBERS UNDER THE CONTROL ARE THE CONTROL. Set a floor too high and
 * nothing happens, forever, and the product looks broken rather than obedient.
 * So the pool is counted at every floor before the page renders
 * (`poolCurveFor`) and the count is read straight off that curve as the member
 * moves the number — no round trip per keystroke, and no row about anybody else
 * in the browser, because a curve is aggregates.
 *
 * Opening and closing the panel discards an unsaved edit, which is the ordinary
 * reading of a disclosure and the reason the chip is fed by what came BACK from
 * the save rather than by what is in the fields.
 */

const INITIAL: PreferencesState = { status: "idle" };

/**
 * Where the slider stops. The number field still goes to {@link MAX_FLOOR}.
 *
 * A floor above this is a site that has decided to sit out, not one it is worth
 * dragging to, and a scale ending at 100 spends most of its length on values
 * nobody picks.
 */
const COARSE_MAX = 90;

export type SiteCardSite = {
    id: string;
    domain: string;
    category: string;
    status: SiteStatus;
    domainRating: number | null;
    linksGiven: number;
    linksGot: number;
    minPartnerDr: number;
    skipUnrated: boolean;
};

export function SiteCard({ site, curve }: { site: SiteCardSite; curve: PoolCurve }) {
    const [state, formAction, pending] = useActionState(saveMatchingPreferencesAction, INITIAL);
    const [open, setOpen] = useState(false);
    const panelId = useId();

    const saved: SavedPreferences =
        state.status === "saved"
            ? state.saved
            : { minPartnerDr: site.minPartnerDr, skipUnrated: site.skipUnrated, curve };

    // A listing that was turned down or banned is never in a pool, so a floor
    // on it is a control over nothing.
    const matchable = site.status !== "rejected" && site.status !== "banned";

    return (
        <li className="border-line bg-surface overflow-hidden rounded-sm border">
            {/* ONE LINE, ALWAYS. A second line here is not a layout, it is a
                row that looks broken next to four that fit — and which row it
                happens to is decided by how long somebody's domain is. So
                nothing wraps: the category gives way first because it is the
                one thing on the row that is guessable from the rest, and the
                counts step aside on a narrow screen. */}
            <div className="flex items-center gap-3 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-x-3">
                    <span className="shrink-0 text-[15px] font-medium">{site.domain}</span>
                    <span className="text-muted truncate text-[13.5px]">{site.category}</span>
                    <span
                        className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase",
                            site.status === "active"
                                ? "border-ok/40 bg-ok-soft text-ok-text"
                                : "border-line text-muted bg-surface-2",
                        )}>
                        {site.status.replace(/_/g, " ")}
                    </span>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                    {matchable ? <FloorChip saved={saved} /> : null}
                    <span className="text-muted hidden font-mono text-[11.5px] whitespace-nowrap sm:inline">
                        DR {site.domainRating ?? "n/a"} · {site.linksGiven} given · {site.linksGot} received
                    </span>
                    {matchable ? (
                        <button
                            type="button"
                            onClick={() => setOpen((value) => !value)}
                            aria-expanded={open}
                            aria-controls={panelId}
                            aria-label={`Who ${site.domain} matches with`}
                            className={cn(
                                "grid size-9 shrink-0 place-items-center rounded-sm border",
                                open
                                    ? "border-accent bg-accent-soft text-accent-text"
                                    : "border-line text-muted hover:bg-surface-2 hover:text-fg",
                            )}>
                            <SlidersHorizontal aria-hidden="true" className="size-4" />
                        </button>
                    ) : null}
                </div>
            </div>

            {matchable && open ? (
                <MatchingPanel
                    id={panelId}
                    site={site}
                    saved={saved}
                    state={state}
                    formAction={formAction}
                    pending={pending}
                />
            ) : null}
        </li>
    );
}

/**
 * What the closed row says about the floor, or nothing when there is none.
 *
 * A site that takes everybody is the default and gets no chip at all: a list
 * where every row carries a badge saying "no setting" is a list of noise.
 */
function FloorChip({ saved }: { saved: SavedPreferences }) {
    const { minPartnerDr, skipUnrated, curve } = saved;
    const blocked = curve.total > 0 && mutualAt(curve, minPartnerDr, skipUnrated) === 0;

    // Short on purpose: the words that fit here are the setting, and spelling
    // out the problem as well wrapped the row onto a second line. The accent
    // and the triangle are what say something is wrong, the panel says what.
    if (blocked) {
        return (
            <span
                title="Nothing in your pool can be matched with this site right now."
                className="border-accent/50 bg-accent-soft text-accent-text flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase">
                <AlertTriangle aria-hidden="true" className="size-3" />
                {minPartnerDr > 0 ? `min DR ${minPartnerDr}` : "no matches"}
                <span className="sr-only">, nothing in the pool can be matched with it</span>
            </span>
        );
    }

    if (minPartnerDr === 0 && !skipUnrated) return null;

    const label = [minPartnerDr > 0 ? `min DR ${minPartnerDr}` : null, skipUnrated ? "rated only" : null]
        .filter(Boolean)
        .join(" · ");

    return (
        <span className="border-line bg-surface-2 text-muted rounded-full border px-2.5 py-0.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase">
            {label}
        </span>
    );
}

/** The editor itself, twin of `set_matching_preferences`. */
function MatchingPanel({
    id,
    site,
    saved,
    state,
    formAction,
    pending,
}: {
    id: string;
    site: SiteCardSite;
    saved: SavedPreferences;
    state: PreferencesState;
    formAction: (payload: FormData) => void;
    pending: boolean;
}) {
    const [floor, setFloor] = useState(saved.minPartnerDr);
    const [skipUnrated, setSkipUnrated] = useState(saved.skipUnrated);

    const floorId = useId();
    const skipId = useId();

    const curve = saved.curve;
    const coarsePercent = (Math.min(floor, COARSE_MAX) / COARSE_MAX) * 100;
    const admitted = admittedAt(curve, floor, skipUnrated);
    const mutual = mutualAt(curve, floor, skipUnrated);
    const blocked = mutual === 0 && curve.total > 0;

    const error = state.status === "error" ? state.message : state.status === "signed_out" ? SIGNED_OUT : null;

    function nudge(by: number) {
        setFloor((value) => Math.min(Math.max(value + by, 0), MAX_FLOOR));
    }

    return (
        <form id={id} action={formAction} className="border-line bg-bg/60 border-t px-4 py-4">
            <input type="hidden" name="siteId" value={site.id} />

            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <label htmlFor={floorId} className="text-[13.5px]">
                    Minimum partner DR
                </label>

                <div className="border-line-strong bg-bg inline-flex items-stretch overflow-hidden rounded-sm border">
                    <button
                        type="button"
                        onClick={() => nudge(-1)}
                        aria-label="Lower the minimum"
                        className="border-line bg-surface-2 hover:bg-surface-2/60 w-10 border-r text-[17px] leading-none">
                        −
                    </button>
                    <input
                        id={floorId}
                        name="minPartnerDr"
                        type="number"
                        min={0}
                        max={MAX_FLOOR}
                        step={1}
                        value={floor}
                        onChange={(event) => setFloor(clampFloor(event.target.value))}
                        className="bg-surface w-16 py-2.5 text-center font-mono text-[15px] outline-none"
                    />
                    <button
                        type="button"
                        onClick={() => nudge(1)}
                        aria-label="Raise the minimum"
                        className="border-line bg-surface-2 hover:bg-surface-2/60 w-10 border-l text-[17px] leading-none">
                        +
                    </button>
                </div>

                {/* Styled rather than native: the platform track renders as a
                    near-black bar, which is heavier than anything else in this
                    panel. Appearance is dropped, so the fill that says how far
                    along the range this is has to be drawn here. */}
                <input
                    type="range"
                    min={0}
                    max={COARSE_MAX}
                    step={1}
                    value={Math.min(floor, COARSE_MAX)}
                    onChange={(event) => setFloor(clampFloor(event.target.value))}
                    aria-label="Minimum partner DR, coarse"
                    style={{
                        background: `linear-gradient(to right, var(--accent) ${coarsePercent}%, var(--line-strong) ${coarsePercent}%)`,
                    }}
                    className="h-1.5 min-w-[160px] flex-1 appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)]"
                />
            </div>

            <div className="mt-3.5 flex items-start gap-2.5">
                <input
                    id={skipId}
                    name="skipUnrated"
                    type="checkbox"
                    checked={skipUnrated}
                    onChange={(event) => setSkipUnrated(event.target.checked)}
                    className="accent-accent mt-0.5 size-4"
                />
                <label htmlFor={skipId} className="text-[13.5px] leading-relaxed">
                    Skip sites we could not rate
                    <span className="text-muted">
                        {" — "}
                        {curve.unrated === 0
                            ? "none in your pool right now"
                            : `${curve.unrated} in your pool ${curve.unrated === 1 ? "has" : "have"} no DR measured`}
                        . A missing score is one we could not read, not a low one.
                    </span>
                </label>
            </div>

            <p
                aria-live="polite"
                className={cn(
                    "mt-4 flex items-start gap-2 rounded-sm border px-3 py-2.5 text-[13px] leading-relaxed",
                    blocked ? "border-accent/40 bg-accent-soft" : "border-line bg-surface-2/60 text-muted",
                )}>
                {blocked ? <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : null}
                <span>{reachSentence({ site, curve, floor, admitted, mutual })}</span>
            </p>

            {error ? (
                <p role="status" className="text-accent-text mt-3 text-[13px]">
                    {error}
                </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                    type="submit"
                    disabled={pending}
                    className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center gap-2 rounded-sm px-5 py-2.5 text-[14px] font-semibold disabled:opacity-60">
                    {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                    Save
                </button>
                <span className="text-muted text-[12.5px]">
                    {state.status === "saved"
                        ? "Saved. The next pairing uses it."
                        : "Applies to new matches. An open exchange is left alone."}
                </span>
            </div>
        </form>
    );
}

const SIGNED_OUT = "Your session ended. Sign in again and the change will save.";

/** Keeps a typed or dragged value inside the column's range. */
function clampFloor(raw: string): number {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return 0;
    return Math.min(Math.max(parsed, 0), MAX_FLOOR);
}

/**
 * What the counts mean, in a sentence.
 *
 * The mutual number leads, because it is the one that predicts a match: a
 * partner this site would take is worth nothing if their own floor turns it
 * down, and the member's own DR is the thing they cannot change.
 */
function reachSentence(input: {
    site: SiteCardSite;
    curve: PoolCurve;
    floor: number;
    admitted: number;
    mutual: number;
}): string {
    const { site, curve, floor, admitted, mutual } = input;

    if (curve.total === 0) {
        return "Nobody else is listed in your pool yet, so this waits for the first site to join.";
    }
    if (mutual === 0) {
        return floor > 0
            ? `Nothing in your pool clears DR ${floor} and would trade with ${site.domain}, so it will sit out of matching until something does.`
            : `Nothing in your pool would trade with ${site.domain} right now, so it will sit out of matching until something does.`;
    }

    // Two different sentences, because "16 of 16 clear any DR" is a filter
    // reporting that it filtered nothing.
    const mine = site.domainRating === null ? "an unrated site" : `a DR ${site.domainRating} site`;
    const sites = curve.total === 1 ? "site" : "sites";
    const them = mutual === 1 ? "one of them would" : `${mutual} of them would`;
    if (floor === 0) {
        return `All ${curve.total} ${sites} in your pool are on the table, and ${them} trade with ${mine}.`;
    }
    const clear = admitted === 1 ? "clears" : "clear";
    return `${admitted} of ${curve.total} ${sites} in your pool ${clear} DR ${floor} and up, and ${them} trade with ${mine}.`;
}
