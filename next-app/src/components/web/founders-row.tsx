/**
 * @file Founding members: who is already here, and how to become one.
 *
 * ON THE COUNT. The landing page used to print no numbers at all, because a
 * hardcoded member count is a lie that ages badly. This one is different in the
 * way that matters: it is `getFounderCount()` read from the database on every
 * revalidation, so it cannot be wrong. Below `MIN_COUNT_TO_PRINT` it prints no
 * number at all and invites instead, because "Join 0+ founders" is worse than
 * saying nothing.
 *
 * `count` is `null` when the database could not be reached. That is treated
 * exactly like too-small: the row still renders and still invites, it just
 * makes no claim. A front page that 500s because a count query failed would be
 * a much worse outcome than a missing number.
 */

"use client";

import Image from "next/image";
import { useState } from "react";

import { cn } from "@/components/web/cn";
import { FounderModal } from "@/components/web/founder-modal";

/**
 * Below this, the row shows no number and invites instead.
 *
 * One, deliberately: a real single-digit count is honest and this is an early
 * product. Raise it if a low number ever reads as an admission rather than as
 * early access. Never lower it to zero.
 */
const MIN_COUNT_TO_PRINT = 1;

const AVATAR_SRC = "/founders/nicklaunches.png";

type FoundersRowProps = {
    /** Live member count, or null when the count could not be read. */
    count: number | null;
};

/**
 * The base layer of the avatar slot.
 *
 * Always rendered, with the photo laid over it, rather than swapped in when the
 * photo fails. The slot is then never empty: not before the file exists, not
 * while a lazy image has yet to start loading, and not in the gap between the
 * request and its error. Swapping instead of layering left a hole exactly the
 * size of an avatar, which reads as a broken page.
 */
function Monogram() {
    return (
        <span
            aria-hidden="true"
            className="bg-accent-soft text-accent-text flex size-9 items-center justify-center rounded-full font-mono text-[11px] font-semibold tracking-tight">
            NL
        </span>
    );
}

export function FoundersRow({ count }: FoundersRowProps) {
    const [modalOpen, setModalOpen] = useState(false);
    const [avatarFailed, setAvatarFailed] = useState(false);

    const showCount = count !== null && count >= MIN_COUNT_TO_PRINT;

    return (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <div className="flex -space-x-2">
                {/* ring-bg, not a border: the ring is drawn outside the circle,
                    so the avatars keep their full size while still reading as
                    separated where they overlap. */}
                <span className="ring-bg relative inline-flex rounded-full ring-2">
                    <Monogram />
                    {avatarFailed ? null : (
                        /*
                            `unoptimized`, for two independent reasons. It is a
                            36px avatar, so there is nothing for the optimizer
                            to save, and the source is pixel art, which
                            resampling turns to mush. It also keeps a missing
                            file cheap: through the optimizer an absent source
                            is a 500 on every render, and as a plain request it
                            is a 404 that `onError` quietly drops.

                            `eager`, because the fallback depends on the request
                            actually being made. A lazy image that never enters
                            the viewport never errors either, and the slot would
                            sit there waiting on a file that does not exist.
                        */
                        <Image
                            src={AVATAR_SRC}
                            alt="Nick, the founder of builders/backlinks"
                            width={72}
                            height={72}
                            unoptimized
                            loading="eager"
                            onError={() => setAvatarFailed(true)}
                            className="absolute inset-0 size-9 rounded-full object-cover"
                        />
                    )}
                </span>

                <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    aria-haspopup="dialog"
                    aria-label="Claim a founding spot"
                    className={cn(
                        "border-line-strong text-muted ring-bg relative inline-flex size-9 items-center justify-center",
                        "bg-surface hover:border-accent hover:text-accent-text rounded-full border border-dashed",
                        "text-[15px] leading-none font-medium ring-2 transition-colors",
                    )}>
                    <span aria-hidden="true">+</span>
                </button>
            </div>

            <p className="text-[14.5px] leading-relaxed">
                {showCount ? (
                    <>
                        <span className="border-accent border-b-2 pb-0.5 font-semibold">Join {count}+ founders</span>{" "}
                        <span className="text-muted">trading links from their agent</span>
                    </>
                ) : (
                    <>
                        <span className="border-accent border-b-2 pb-0.5 font-semibold">Founding spots are open</span>{" "}
                        <span className="text-muted">be one of the first on the exchange</span>
                    </>
                )}
            </p>

            <FounderModal open={modalOpen} onClose={() => setModalOpen(false)} />
        </div>
    );
}
