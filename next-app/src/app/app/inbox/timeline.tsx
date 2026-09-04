"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { RelativeTime } from "@/app/app/inbox/relative-time";
import { formatDateTime } from "@/app/app/inbox/shared";
import { cn } from "@/components/web/cn";
import { linkifySegments } from "@/lib/inbox";

/**
 * @file The conversation: system lines and messages, in one column.
 *
 * MESSAGE BODIES ARE TEXT AND STAY TEXT. They are rendered as children, never
 * through `dangerouslySetInnerHTML`, so React escapes them. Links are found by
 * `linkifySegments`, which only ever returns an `http`/`https` href — a member
 * typing `javascript:` gets a string on screen, not a scheme in an anchor.
 */

/** A message the client has sent but the server has not confirmed. */
export type PendingMessage = {
    id: string;
    body: string;
    createdAt: string;
    failed: boolean;
};

export type TimelineItem =
    | { kind: "event"; id: string; at: string; text: string }
    | { kind: "message"; id: string; at: string; body: string; mine: boolean; senderLabel: string }
    | { kind: "pending"; id: string; at: string; body: string; failed: boolean };

export function Timeline({ items, onRetry }: { items: TimelineItem[]; onRetry: (id: string) => void }) {
    return (
        <ol className="flex flex-col gap-4 px-5 py-6 sm:px-6">
            {items.map((item) =>
                item.kind === "event" ? (
                    <li key={item.id} className="flex justify-center">
                        {/* An automated line is part of the conversation, not a
                            caption on it: same column, same rhythm, visibly not
                            written by either member. */}
                        <p className="border-line bg-surface-2/50 text-muted max-w-[52ch] rounded-sm border px-3 py-2 text-center text-[12px] leading-relaxed">
                            {item.text}{" "}
                            <RelativeTime iso={item.at} className="font-mono text-[11px] whitespace-nowrap" />
                        </p>
                    </li>
                ) : (
                    <li key={item.id} className={cn("flex", isMine(item) ? "justify-end" : "justify-start")}>
                        <div className={cn("max-w-[min(38rem,85%)]", isMine(item) && "items-end")}>
                            <div
                                className={cn(
                                    "rounded-sm border px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap",
                                    isMine(item) ? "border-accent/25 bg-accent-soft" : "border-line bg-surface-2/70",
                                    item.kind === "pending" && !item.failed && "opacity-70",
                                    item.kind === "pending" && item.failed && "border-line-strong",
                                )}>
                                <MessageBody body={item.body} />
                            </div>

                            <div
                                className={cn(
                                    "text-muted mt-1 flex items-center gap-1.5 font-mono text-[10.5px]",
                                    isMine(item) ? "justify-end" : "justify-start",
                                )}>
                                {item.kind === "pending" ? (
                                    item.failed ? (
                                        <>
                                            <AlertTriangle aria-hidden="true" className="size-3" />
                                            <span>Not sent</span>
                                            <button
                                                type="button"
                                                onClick={() => onRetry(item.id)}
                                                className="text-accent-text underline underline-offset-2">
                                                Retry
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                                            <span>Sending</span>
                                        </>
                                    )
                                ) : (
                                    <>
                                        <span>{item.senderLabel}</span>
                                        <span aria-hidden="true">·</span>
                                        <RelativeTime iso={item.at} className="whitespace-nowrap" />
                                        <span className="sr-only">{formatDateTime(item.at)}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </li>
                ),
            )}
        </ol>
    );
}

function isMine(item: TimelineItem): boolean {
    return item.kind === "pending" || (item.kind === "message" && item.mine);
}

function MessageBody({ body }: { body: string }) {
    return (
        <>
            {linkifySegments(body).map((segment, index) =>
                segment.href ? (
                    <a
                        key={index}
                        href={segment.href}
                        target="_blank"
                        rel="nofollow noopener noreferrer"
                        className="text-accent-text break-all underline underline-offset-2">
                        {segment.text}
                    </a>
                ) : (
                    <span key={index}>{segment.text}</span>
                ),
            )}
        </>
    );
}
