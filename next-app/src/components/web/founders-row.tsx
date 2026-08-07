/**
 * @file Who is already here, and how to join them.
 *
 * ON THE COUNT. The landing page used to print no numbers at all, because a
 * hardcoded member count is a lie that ages badly. This one is different in the
 * way that matters: it is `getFounderCount()` read from the database on every
 * revalidation, so it cannot be wrong. Below `MIN_COUNT_TO_PRINT` it prints no
 * number at all and invites instead, because "Join 0+ builders" is worse than
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

/** Avatars are local files, not hotlinked profile pictures that can vanish. */
const BUILDERS = [
    { handle: "nicklaunches", initials: "NL", src: "/founders/nicklaunches.png" },
    { handle: "hakimuddinkika", initials: "HK", src: "/founders/hakimuddinkika.jpg" },
    { handle: "vibecodinglist", initials: "VCL", src: "/founders/vibecodinglist.png" },
] as const;

type FoundersRowProps = {
    /** Live member count, or null when the count could not be read. */
    count: number | null;
};

/**
 * One avatar: a monogram with the photo laid over it.
 *
 * The monogram is always rendered rather than swapped in when the photo fails.
 * The slot is then never empty: not before the file exists, not while a lazy
 * image has yet to start loading, and not in the gap between the request and its
 * error. Swapping instead of layering left a hole exactly the size of an avatar,
 * which reads as a broken page.
 */
function Avatar({ handle, initials, src }: (typeof BUILDERS)[number]) {
    const [failed, setFailed] = useState(false);

    return (
        // ring-bg, not a border: the ring is drawn outside the circle, so the
        // avatars keep their full size while still reading as separated where
        // they overlap.
        <span className="ring-bg relative inline-flex rounded-full ring-2">
            <span
                aria-hidden="true"
                className="bg-accent-soft text-accent-text flex size-9 items-center justify-center rounded-full font-mono text-[11px] font-semibold tracking-tight">
                {initials}
            </span>
            {failed ? null : (
                /*
                    `unoptimized`, for two independent reasons. These are 36px
                    avatars, so there is nothing for the optimizer to save, and
                    one source is pixel art, which resampling turns to mush. It
                    also keeps a missing file cheap: through the optimizer an
                    absent source is a 500 on every render, and as a plain
                    request it is a 404 that `onError` quietly drops.

                    `eager`, because the fallback depends on the request actually
                    being made. A lazy image that never enters the viewport never
                    errors either, and the slot would sit there waiting on a file
                    that does not exist.
                */
                <Image
                    src={src}
                    alt={`@${handle}`}
                    width={72}
                    height={72}
                    unoptimized
                    loading="eager"
                    onError={() => setFailed(true)}
                    className="absolute inset-0 size-9 rounded-full object-cover"
                />
            )}
        </span>
    );
}

export function FoundersRow({ count }: FoundersRowProps) {
    const [modalOpen, setModalOpen] = useState(false);

    const showCount = count !== null && count >= MIN_COUNT_TO_PRINT;

    return (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <div className="flex -space-x-2">
                {BUILDERS.map((builder) => (
                    <Avatar key={builder.handle} {...builder} />
                ))}

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
                        <span className="border-accent border-b-2 pb-0.5 font-semibold">Join {count}+ builders</span>{" "}
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
