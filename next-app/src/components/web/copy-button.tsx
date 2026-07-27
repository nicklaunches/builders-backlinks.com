/**
 * @file Copy-to-clipboard button for the install snippets.
 *
 * Deliberately announces the result rather than only animating it: a reader who
 * cannot see the icon swap still gets "Copied" from the live region.
 */

"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/components/web/cn";

type CopyButtonProps = {
    /** Exact text placed on the clipboard. */
    value: string;
    /** Describes what is being copied, for screen readers. */
    label?: string;
    className?: string;
};

export function CopyButton({ value, label = "install command", className }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    async function onCopy() {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // Clipboard can be blocked (insecure origin, denied permission).
            // Nothing useful to recover with: the text is selectable on screen.
            return;
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
    }

    return (
        <button
            type="button"
            onClick={onCopy}
            aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
            className={cn(
                "border-term-line text-term-dim hover:text-term-bright hover:border-term-dim",
                "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5",
                "font-mono text-[11px] tracking-wide uppercase transition-colors",
                copied && "border-term-ok/50 text-term-ok hover:text-term-ok",
                className,
            )}>
            {copied ? (
                <Check aria-hidden="true" className="size-3.5" />
            ) : (
                <Copy aria-hidden="true" className="size-3.5" />
            )}
            <span aria-hidden="true">{copied ? "Copied" : "Copy"}</span>
            <span role="status" aria-live="polite" className="sr-only">
                {copied ? `Copied ${label}` : ""}
            </span>
        </button>
    );
}
