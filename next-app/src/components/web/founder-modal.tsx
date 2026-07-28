/**
 * @file The "claim a founding spot" dialog, opened from the founders row.
 *
 * Built on the native `<dialog>` element rather than a portal. That gets the
 * focus trap, `Esc` to dismiss, the inert background and focus restoration to
 * the trigger from the platform, which is most of what a modal is and all of
 * what is easy to get wrong. It is also the only modal in this app, so pulling
 * in a UI library to render one card would be a poor trade.
 *
 * Do NOT reach for `window.alert` / `confirm` here or anywhere else on the
 * site: they block the whole page and cannot be styled or tested.
 *
 * The spot is genuinely handed out by hand right now, so the dialog says so and
 * points at a DM rather than pretending there is a queue to join.
 */

"use client";

import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/components/web/cn";

export const NICKLAUNCHES_X_URL = "https://x.com/nicklaunches";

type FounderModalProps = {
    open: boolean;
    onClose: () => void;
};

export function FounderModal({ open, onClose }: FounderModalProps) {
    const ref = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    // `showModal()` is imperative and has no declarative equivalent, so open
    // state is mirrored onto the element instead of being rendered from it.
    // Guarding on `dialog.open` matters: calling `showModal()` on an already
    // open dialog throws InvalidStateError.
    useEffect(() => {
        const dialog = ref.current;
        if (!dialog) return;

        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
    }, [open]);

    return (
        <dialog
            ref={ref}
            aria-labelledby={titleId}
            // Esc closes a native dialog by itself, which would leave the
            // element shut while React still believed it was open. The next
            // click on the trigger would then set `open` to a value it already
            // held, re-render nothing, and the button would look broken. So the
            // platform's dismissal is cancelled and re-routed through state:
            // React closes the element, never the other way round.
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            // Any remaining path that ends in a real `close` (a form submitted
            // with method="dialog", devtools) still gets state back in sync.
            onClose={onClose}
            // A click that lands on the dialog element itself came from the
            // backdrop: the real content is in the child below, and clicks on
            // it never reach here as `currentTarget === target`.
            onClick={(event) => {
                if (event.target === ref.current) onClose();
            }}
            className={cn(
                // `m-auto` is load-bearing, not spacing. The UA stylesheet
                // centres an open modal dialog with `inset: 0; margin: auto`,
                // and Tailwind's preflight zeroes every margin, which drops the
                // dialog into the top-left corner. This puts it back.
                "border-line bg-surface text-fg m-auto w-[calc(100vw-2.5rem)] max-w-md rounded-sm border p-0",
                "shadow-2xl shadow-black/20 backdrop:bg-black/55",
            )}>
            <div className="p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                    <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.015em]">
                        Claim a founding spot
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="text-muted hover:bg-surface-2 hover:text-fg -mt-1 -mr-1 rounded-sm p-1 transition-colors">
                        <X aria-hidden="true" className="size-4.5" />
                    </button>
                </div>

                <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                    Founding members get their site into the first matching round. Spots are handed out by hand for now,
                    so send a message and I will set yours up.
                </p>

                <a
                    href={NICKLAUNCHES_X_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                        "bg-accent text-accent-fg hover:bg-accent-hover mt-6 inline-flex w-full items-center",
                        "justify-center gap-2 rounded-sm px-5 py-3 text-[14.5px] font-semibold transition-colors",
                    )}>
                    DM @nicklaunches on X
                    <ArrowUpRight aria-hidden="true" className="size-4" />
                </a>
            </div>
        </dialog>
    );
}
