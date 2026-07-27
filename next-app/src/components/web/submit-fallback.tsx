/**
 * @file The web path, for people who do not drive an agent.
 *
 * Collapsed by default because the agent flow is the recommended one, but
 * deliberately given a full-width bordered card and a plain-language label so
 * a founder who has never installed an MCP server can still find the front
 * door in one glance. Hiding this would cost real signups.
 *
 * Posts to `/submit`, which does not exist yet. That route is someone else's
 * work in flight; the form is wired to it so nothing has to be rewired later.
 */

"use client";

import { ArrowRight, ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/components/web/cn";

export function SubmitFallback() {
    const [open, setOpen] = useState(false);
    const regionId = useId();
    const fieldId = useId();

    return (
        <section aria-labelledby={`${regionId}-heading`} className="border-line bg-surface rounded-xl border">
            <h2 id={`${regionId}-heading`} className="sr-only">
                Submit on the web
            </h2>

            <button
                type="button"
                onClick={() => setOpen((previous) => !previous)}
                aria-expanded={open}
                aria-controls={regionId}
                className={cn(
                    "group flex w-full items-center justify-between gap-4 px-5 py-4 text-left sm:px-6 sm:py-5",
                    "hover:bg-surface-2 transition-colors",
                    open ? "rounded-t-xl" : "rounded-xl",
                )}>
                <span className="min-w-0">
                    <span className="block text-[15px] font-semibold sm:text-base">
                        Not using an agent? Submit on the web
                    </span>
                    <span className="text-muted mt-0.5 block text-[13.5px] leading-relaxed">
                        Same exchange, same rules. Paste a URL and we draft the listing for you.
                    </span>
                </span>
                <ChevronDown
                    aria-hidden="true"
                    className={cn("text-muted size-5 shrink-0 transition-transform duration-200", open && "rotate-180")}
                />
            </button>

            <div id={regionId} hidden={!open} className="border-line border-t px-5 pt-5 pb-6 sm:px-6">
                <form action="/submit" method="post" className="flex flex-col gap-3 sm:flex-row">
                    <div className="flex-1">
                        <label htmlFor={fieldId} className="sr-only">
                            Your site URL
                        </label>
                        <input
                            id={fieldId}
                            name="url"
                            type="url"
                            required
                            inputMode="url"
                            autoComplete="url"
                            spellCheck={false}
                            placeholder="https://yourapp.com"
                            className={cn(
                                "border-line bg-bg text-fg placeholder:text-muted/70 w-full rounded-lg border",
                                "px-3.5 py-3 font-mono text-[14px] outline-none",
                                "focus:border-accent transition-colors",
                            )}
                        />
                    </div>
                    <button
                        type="submit"
                        className={cn(
                            "bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center gap-2",
                            "rounded-lg px-5 py-3 text-[14.5px] font-semibold whitespace-nowrap transition-colors",
                        )}>
                        Draft my listing
                        <ArrowRight aria-hidden="true" className="size-4" />
                    </button>
                </form>

                <p className="text-muted mt-3 font-mono text-[12.5px]">
                    Free · your URL stays hidden until you both agree
                </p>
            </div>
        </section>
    );
}
