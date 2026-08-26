"use client";

import { SendHorizontal, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/web/cn";
import { MESSAGE_MAX_LENGTH } from "@/lib/inbox";

/**
 * @file The reply box.
 *
 * Enter sends and Shift+Enter breaks the line, which is what every chat does and
 * therefore what fingers expect. The hint under the box says so rather than
 * leaving people to discover that Enter posted a half-written message.
 *
 * The box grows with the text up to a ceiling and then scrolls, so a long reply
 * never pushes the conversation off the screen.
 */

const MAX_ROWS_PX = 200;

export function Composer({
    onSend,
    disabled,
    suggestion,
}: {
    onSend: (body: string) => void;
    disabled?: boolean;
    /** Offered while the box is empty on a thread nobody has written in yet. */
    suggestion?: string;
}) {
    const [value, setValue] = useState("");
    const box = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const node = box.current;
        if (!node) return;
        node.style.height = "auto";
        node.style.height = `${Math.min(node.scrollHeight, MAX_ROWS_PX)}px`;
    }, [value]);

    const trimmed = value.trim();
    const tooLong = trimmed.length > MESSAGE_MAX_LENGTH;
    const canSend = trimmed.length > 0 && !tooLong && !disabled;

    function send() {
        if (!canSend) return;
        onSend(trimmed);
        setValue("");
    }

    return (
        <div className="border-line bg-bg border-t px-5 py-4 sm:px-6">
            {/* A blank box on a thread with nothing in it is the hardest message
                to write, and the one the whole trade waits on. */}
            {suggestion && value.length === 0 ? (
                <button
                    type="button"
                    onClick={() => setValue(suggestion)}
                    className="border-line hover:border-line-strong hover:bg-surface-2 text-muted hover:text-fg mb-2 inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] transition-colors">
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    Start with a suggested opener
                </button>
            ) : null}

            <div className="border-line bg-surface focus-within:border-line-strong flex items-end gap-2 rounded-sm border p-2 transition-colors">
                <textarea
                    ref={box}
                    rows={1}
                    value={value}
                    disabled={disabled}
                    onChange={(event) => setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            send();
                        }
                    }}
                    placeholder="Write a reply…"
                    aria-label="Write a reply"
                    className="text-fg placeholder:text-muted max-h-[200px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed outline-none disabled:cursor-not-allowed"
                />
                <button
                    type="button"
                    onClick={send}
                    disabled={!canSend}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-sm px-4 py-2.5 text-[14px] font-semibold transition-colors",
                        canSend
                            ? "bg-accent text-accent-fg hover:bg-accent-hover"
                            : "border-line text-muted cursor-not-allowed border",
                    )}>
                    <SendHorizontal aria-hidden="true" className="size-4" />
                    Send
                </button>
            </div>

            <p className={cn("mt-2 text-[11.5px]", tooLong ? "text-accent-text" : "text-muted")}>
                {tooLong
                    ? `That is ${trimmed.length - MESSAGE_MAX_LENGTH} characters over the ${MESSAGE_MAX_LENGTH} limit.`
                    : "Enter sends · Shift + Enter starts a new line"}
            </p>
        </div>
    );
}
