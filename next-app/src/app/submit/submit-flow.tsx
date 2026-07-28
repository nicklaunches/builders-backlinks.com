"use client";

import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { useActionState, useId, useState } from "react";

import { type DraftState, draftSiteAction } from "@/app/submit/actions";
import { ReviewForm } from "@/app/submit/review-form";
import { cn } from "@/components/web/cn";

/**
 * @file Step one of `/submit`, and the switch into step two.
 *
 * Mirrors `submit_site` called without `confirm`: the URL goes in, a draft
 * listing comes back, and nothing is written until a human has read it.
 *
 * The pending state is spelled out rather than being a spinner with the word
 * "Loading". Drafting fetches the page, asks an LLM to write an
 * identity-scrubbed description, and looks up Domain Rating, which is genuinely
 * several seconds. A reader who knows why it is slow waits; a reader watching
 * an unexplained spinner reloads and starts the whole thing again.
 */

const INITIAL: DraftState = { status: "idle" };

const PENDING_STEPS = [
    "Fetching the page",
    "Drafting an identity-scrubbed description",
    "Looking up Domain Rating at Ahrefs",
] as const;

export function SubmitFlow({ initialUrl, signInHref }: { initialUrl: string; signInHref: string }) {
    const [state, formAction, pending] = useActionState(draftSiteAction, INITIAL);
    // Seeded from `?url=`, so a URL typed on the landing page (and carried
    // through the sign-in round trip) is never typed twice.
    const [url, setUrl] = useState(initialUrl);

    const fieldId = useId();
    const errorId = useId();
    const helpId = useId();

    if (state.status === "ok") {
        return <ReviewForm draft={state.draft} onStartOver={() => window.location.reload()} />;
    }

    const error =
        state.status === "error"
            ? state.message
            : state.status === "signed_out"
              ? "Your session expired. Sign in again and we will pick this back up."
              : null;

    return (
        <div className="flex flex-col gap-6">
            <form action={formAction} className="flex flex-col gap-3">
                <label htmlFor={fieldId} className="text-[14.5px] font-semibold">
                    Your site URL
                </label>
                <p id={helpId} className="text-muted text-[13.5px] leading-relaxed">
                    We read the page and draft the listing for you: category, a description written so it does not name
                    you, suggested anchor phrases, and Domain Rating. You get to correct every one of them before
                    anything is saved.
                </p>

                <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                        id={fieldId}
                        name="url"
                        type="url"
                        required
                        inputMode="url"
                        autoComplete="url"
                        spellCheck={false}
                        disabled={pending}
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="https://yourapp.com"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={[helpId, error ? errorId : null].filter(Boolean).join(" ")}
                        className={cn(
                            "border-line bg-bg text-fg placeholder:text-muted/70 w-full flex-1 rounded-lg border",
                            "px-3.5 py-3 font-mono text-[14px] outline-none",
                            "focus:border-accent transition-colors",
                            "disabled:opacity-60",
                        )}
                    />
                    <button
                        type="submit"
                        disabled={pending}
                        className={cn(
                            "bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center gap-2",
                            "rounded-lg px-5 py-3 text-[14.5px] font-semibold whitespace-nowrap transition-colors",
                            "disabled:cursor-not-allowed disabled:opacity-60",
                        )}>
                        {pending ? (
                            <>
                                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                                Reading your site
                            </>
                        ) : (
                            <>
                                Draft my listing
                                <ArrowRight aria-hidden="true" className="size-4" />
                            </>
                        )}
                    </button>
                </div>
            </form>

            {pending ? (
                <div role="status" aria-live="polite" className="border-line bg-surface rounded-xl border p-5 sm:p-6">
                    <p className="text-[14.5px] font-semibold">Working on it. This takes a few seconds.</p>
                    <ul className="text-muted mt-3 flex flex-col gap-2 text-[13.5px]">
                        {PENDING_STEPS.map((step) => (
                            <li key={step} className="flex items-center gap-2.5">
                                <Loader2 aria-hidden="true" className="text-accent size-3.5 animate-spin" />
                                {step}
                            </li>
                        ))}
                    </ul>
                    <p className="text-muted mt-4 text-[13px] leading-relaxed">
                        Nothing is written yet. You will see the drafted listing next and can change any of it.
                    </p>
                </div>
            ) : null}

            {error ? (
                <div
                    id={errorId}
                    role="alert"
                    className="border-line bg-surface-2 flex items-start gap-2.5 rounded-lg border p-4">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <div className="text-[13.5px] leading-relaxed">
                        <p>{error}</p>
                        {state.status === "signed_out" ? (
                            <a
                                href={signInHref}
                                className="text-accent mt-2 inline-block rounded-sm font-medium underline underline-offset-4">
                                Sign in and try again
                            </a>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
