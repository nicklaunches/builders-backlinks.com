"use client";

import { useSyncExternalStore } from "react";

import { formatDate, formatRelative } from "@/app/app/inbox/shared";

/**
 * @file Clock-dependent text, rendered without a hydration mismatch.
 *
 * "4m" is only true for a minute, so it cannot be produced on the server: the
 * HTML would already be stale by the time React hydrated it. The absolute date
 * renders first and the relative form replaces it on the client, which also
 * leaves a real date on screen for a reader with JavaScript off.
 *
 * `useSyncExternalStore` rather than an effect, and one shared ticker rather
 * than a timer per timestamp: a thread can hold fifty of these, and fifty
 * intervals waking independently is fifty renders a minute.
 */

/** Coarse enough that the snapshot is stable between ticks, which the store requires. */
const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ticker ??= setInterval(() => {
        for (const notify of listeners) notify();
    }, TICK_MS);

    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && ticker) {
            clearInterval(ticker);
            ticker = null;
        }
    };
}

function getSnapshot(): number {
    return Math.floor(Date.now() / TICK_MS);
}

/** The server has no clock to agree with, so it renders the absolute date. */
function getServerSnapshot(): number | null {
    return null;
}

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
    const tick = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    return (
        <time dateTime={iso} className={className} title={formatDate(iso)}>
            {tick === null ? formatDate(iso) : formatRelative(iso, tick * TICK_MS)}
        </time>
    );
}
