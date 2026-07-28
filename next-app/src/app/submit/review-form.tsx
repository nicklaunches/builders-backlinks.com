"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, EyeOff, Loader2, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useActionState, useId, useState } from "react";

import { type CommitState, type DraftPayload, commitSiteAction } from "@/app/submit/actions";
import { DEFAULT_PLACEMENT, PLACEMENT_OPTIONS } from "@/app/submit/options";
import { cn } from "@/components/web/cn";
import { CATEGORIES, UNMATCHABLE } from "@/lib/categories";

/**
 * @file Step two of `/submit`: read the drafted words, correct them, confirm.
 *
 * The single most important thing on this screen is the warning above the
 * description. The description is shown to potential partners BEFORE either
 * side knows who the other is, and it is written not to name the product on
 * purpose. Left unexplained, people "fix" it by pasting their brand back in,
 * which defeats blind matching and gets the listing turned down at review. So
 * the explanation sits directly above the field, not in a tooltip and not in a
 * footnote.
 *
 * Every field is controlled. React resets uncontrolled forms once an action
 * resolves, which would throw away a member's edits the moment the server
 * rejected one field.
 */

const AHREFS_URL = "https://ahrefs.com/website-authority-checker";

/**
 * Domain Rating with its required credit.
 *
 * The Ahrefs Domain Rating free API is licensed on the condition that the score
 * is displayed with visible attribution linking back to their checker, wherever
 * it is shown. This is a license term, not a courtesy, so DR and the credit are
 * one component and cannot be rendered apart.
 */
export function DomainRatingBadge({ value }: { value: number | null }) {
    return (
        <div className="border-line bg-surface-2/60 rounded-sm border px-4 py-3">
            <div className="flex items-baseline gap-2">
                <span className="font-mono text-[22px] leading-none font-semibold">{value ?? "n/a"}</span>
                <span className="text-muted text-[13px]">Domain Rating</span>
            </div>
            <p className="text-muted mt-1.5 text-[11.5px] leading-relaxed">
                Score from{" "}
                <a
                    href={AHREFS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent rounded-sm underline underline-offset-2">
                    Ahrefs
                </a>
                {value == null
                    ? ". We could not read one for this domain, which is not a problem: DR is a sorting hint, never a gate."
                    : ". Partners see this band, not an exact ranking."}
            </p>
        </div>
    );
}

const INITIAL: CommitState = { status: "idle" };

type ReviewFormProps = {
    draft: DraftPayload;
    /** Go back to step one and analyze a different URL. */
    onStartOver: () => void;
};

export function ReviewForm({ draft, onStartOver }: ReviewFormProps) {
    const [state, formAction, pending] = useActionState(commitSiteAction, INITIAL);

    const [category, setCategory] = useState<string>(draft.category);
    const [description, setDescription] = useState<string>(draft.description);
    const [keywords, setKeywords] = useState<string>(draft.keywords.join("\n"));
    const [placement, setPlacement] = useState<string>(DEFAULT_PLACEMENT);

    const categoryId = useId();
    const descriptionId = useId();
    const keywordsId = useId();
    const errorId = useId();
    const blindNoteId = useId();
    const placementId = useId();

    if (state.status === "done") return <SubmittedPanel state={state} />;

    const unmatchable = (UNMATCHABLE as readonly string[]).includes(category);
    const formError = state.status === "error" ? state.message : state.status === "signed_out" ? SIGNED_OUT : null;
    const errorField = state.status === "error" ? state.field : null;

    return (
        <form action={formAction} className="flex flex-col gap-7" aria-describedby={formError ? errorId : undefined}>
            <input type="hidden" name="url" value={draft.url} />
            <input type="hidden" name="domainRating" value={draft.domainRating ?? ""} />
            <input type="hidden" name="signature" value={draft.signature} />

            {/* ---------------------------------------------------------------
                What we read
            --------------------------------------------------------------- */}
            <div className="border-line bg-surface rounded-sm border p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Your domain</p>
                        <p className="mt-1.5 font-mono text-[17px] font-semibold break-all">{draft.domain}</p>
                        {draft.title ? (
                            <p className="text-muted mt-1.5 text-[13.5px]">
                                Page title: <span className="text-fg">{draft.title}</span>{" "}
                                <span className="text-muted">(never shown to partners)</span>
                            </p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={onStartOver}
                        className="text-muted hover:text-fg rounded-sm text-[13px] underline underline-offset-4 transition-colors">
                        Use a different URL
                    </button>
                </div>

                <div className="mt-5">
                    <DomainRatingBadge value={draft.domainRating} />
                </div>
            </div>

            {/* ---------------------------------------------------------------
                Category
            --------------------------------------------------------------- */}
            <div className="flex flex-col gap-2">
                <label htmlFor={categoryId} className="text-[14.5px] font-semibold">
                    Category
                </label>
                <p className="text-muted text-[13.5px] leading-relaxed">
                    You are matched inside this category, and only widened by one adjacent step when it is genuinely
                    thin. Pick the one a reader would expect, not the most flattering one.
                </p>
                <select
                    id={categoryId}
                    name="category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    aria-invalid={errorField === "category" || undefined}
                    aria-describedby={errorField === "category" ? errorId : undefined}
                    className={cn(
                        "border-line bg-bg text-fg w-full rounded-sm border px-3.5 py-3 text-[14.5px]",
                        "focus:border-accent transition-colors outline-none",
                    )}>
                    {CATEGORIES.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
                {unmatchable ? (
                    <p className="text-muted flex items-start gap-2 text-[13px] leading-relaxed">
                        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>
                            &ldquo;{category}&rdquo; is a catch-all bucket, so nothing in it can be matched relevantly.
                            Pick the closest real category instead.
                        </span>
                    </p>
                ) : null}
            </div>

            {/* ---------------------------------------------------------------
                Description. The blind-matching explanation is the point.
            --------------------------------------------------------------- */}
            <div className="flex flex-col gap-2">
                <label htmlFor={descriptionId} className="text-[14.5px] font-semibold">
                    What your site does
                </label>

                <div
                    id={blindNoteId}
                    className="border-accent/35 bg-accent-soft flex items-start gap-3 rounded-sm border p-4">
                    <EyeOff aria-hidden="true" className="text-accent mt-0.5 size-[18px] shrink-0" />
                    <div className="text-[13.5px] leading-relaxed">
                        <p className="font-semibold">This is the only thing a potential partner sees at first.</p>
                        <p className="text-muted mt-1.5">
                            They read it before either of you knows who the other is. It deliberately does not name your
                            product or quote your brand, because your domain stays hidden until you both accept. Adding
                            your name back in breaks that and gets the listing turned down at review. Edit it for
                            accuracy, not for marketing: say what the site does, not what it is called.
                        </p>
                    </div>
                </div>

                <textarea
                    id={descriptionId}
                    name="description"
                    rows={6}
                    maxLength={2000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    aria-invalid={errorField === "description" || undefined}
                    aria-describedby={[blindNoteId, errorField === "description" ? errorId : null]
                        .filter(Boolean)
                        .join(" ")}
                    className={cn(
                        "border-line bg-bg text-fg w-full resize-y rounded-sm border px-3.5 py-3",
                        "text-[14.5px] leading-relaxed outline-none",
                        "focus:border-accent transition-colors",
                    )}
                />
                <p className="text-muted font-mono text-[12px]">{description.length} / 2000</p>
            </div>

            {/* ---------------------------------------------------------------
                Anchors
            --------------------------------------------------------------- */}
            <div className="flex flex-col gap-2">
                <label htmlFor={keywordsId} className="text-[14.5px] font-semibold">
                    Anchor phrases you would like to be linked as
                </label>
                <p className="text-muted text-[13.5px] leading-relaxed">
                    One per line, up to 25. Your partner picks one of these, or writes their own variant so the sentence
                    reads naturally. Phrases beat your brand name here: the link is worth more when the words describe
                    what you do.
                </p>
                <textarea
                    id={keywordsId}
                    name="keywords"
                    rows={5}
                    value={keywords}
                    onChange={(event) => setKeywords(event.target.value)}
                    aria-invalid={errorField === "keywords" || undefined}
                    aria-describedby={errorField === "keywords" ? errorId : undefined}
                    spellCheck={false}
                    className={cn(
                        "border-line bg-bg text-fg w-full resize-y rounded-sm border px-3.5 py-3",
                        "font-mono text-[13.5px] leading-relaxed outline-none",
                        "focus:border-accent transition-colors",
                    )}
                />
            </div>

            {/* ---------------------------------------------------------------
                Placement offered
            --------------------------------------------------------------- */}
            <fieldset className="flex flex-col gap-2">
                <legend id={placementId} className="text-[14.5px] font-semibold">
                    What placement can you offer a partner?
                </legend>
                <p className="text-muted text-[13.5px] leading-relaxed">
                    Most trades that fall apart do so because one side expected a post and the other added a footer
                    link. Saying it up front is why this question exists. Where the link finally goes is still entirely
                    your call.
                </p>
                <div className="mt-1 grid gap-2.5">
                    {PLACEMENT_OPTIONS.map((option) => (
                        <label
                            key={option.value}
                            className={cn(
                                "border-line bg-surface flex cursor-pointer items-start gap-3 rounded-sm border p-4",
                                "hover:border-line-strong transition-colors",
                                placement === option.value && "border-accent/50 bg-accent-soft",
                            )}>
                            <input
                                type="radio"
                                name="placementOffered"
                                value={option.value}
                                checked={placement === option.value}
                                onChange={() => setPlacement(option.value)}
                                className="accent-accent mt-0.5 size-4 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-[14px] font-medium">{option.label}</span>
                                <span className="text-muted mt-0.5 block text-[13px] leading-relaxed">
                                    {option.hint}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>

            {/* ---------------------------------------------------------------
                Errors and submit
            --------------------------------------------------------------- */}
            {formError ? (
                <p
                    id={errorId}
                    role="alert"
                    className="border-line bg-surface-2 flex items-start gap-2.5 rounded-sm border p-4 text-[13.5px] leading-relaxed">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{formError}</span>
                </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                    type="submit"
                    disabled={pending}
                    className={cn(
                        "bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center gap-2",
                        "rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                    )}>
                    {pending ? (
                        <>
                            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                            Listing your site
                        </>
                    ) : (
                        <>
                            Confirm and list my site
                            <ArrowRight aria-hidden="true" className="size-4" />
                        </>
                    )}
                </button>
                <p className="text-muted text-[13px] leading-relaxed">
                    Nothing has been written yet. Your URL and email stay hidden from partners until you both accept.
                </p>
            </div>

            <p aria-live="polite" className="sr-only">
                {pending ? "Listing your site and looking for a partner." : ""}
            </p>
        </form>
    );
}

const SIGNED_OUT = "Your session expired before we could save this. Sign in again and resubmit, nothing was written.";

function SubmittedPanel({ state }: { state: Extract<CommitState, { status: "done" }> }) {
    const Icon = state.matched ? PartyPopper : CheckCircle2;

    return (
        <section className="border-accent/35 bg-accent-soft rounded-sm border p-6 sm:p-8" aria-live="polite">
            <span className="border-line bg-surface text-accent mb-4 inline-flex size-10 items-center justify-center rounded-sm border">
                <Icon aria-hidden="true" className="size-5" />
            </span>

            <h2 className="text-[1.35rem] font-semibold tracking-[-0.02em]">{state.headline}</h2>
            <p className="mt-3 text-[15px] leading-relaxed">{state.outcome}</p>

            <p className="text-muted mt-4 text-[14px] leading-relaxed">
                Review is a human reading the listing, usually the same day. Nothing is matched publicly until it
                passes.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                    href="/app/key"
                    className="bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center rounded-sm px-5 py-3 text-[14.5px] font-semibold transition-colors">
                    Get your MCP key
                </a>
                <Link
                    href="/"
                    className="border-line hover:border-line-strong hover:bg-surface inline-flex items-center justify-center rounded-sm border px-5 py-3 text-[14.5px] font-medium transition-colors">
                    Back to the home page
                </Link>
            </div>

            <p className="text-muted mt-5 text-[13.5px] leading-relaxed">
                Everything after this point is faster from an agent: accepting a match, getting the link brief, and
                writing the link into your repo are one instruction each.
            </p>
        </section>
    );
}
