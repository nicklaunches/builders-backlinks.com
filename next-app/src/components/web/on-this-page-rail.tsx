/**
 * @file The sticky section outline for long documentation pages.
 *
 * The flat `OnThisPage` index in the masthead is read once and then scrolls
 * away, which is fine for a two-screen legal page and useless on the MCP
 * reference, where someone is jumping between the tool table and the worked
 * example. This is the companion for those: it follows the reader and shows
 * where they are.
 *
 * It is the only client component on the docs page. Everything degrades if the
 * JavaScript never arrives: the markup is plain anchors, so navigation still
 * works and only the active highlight is lost.
 */

"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/web/cn";

export type OutlineItem = { href: string; label: string };

/**
 * Chooses the "current" section from what is on screen.
 *
 * The top and bottom bias matters. With a symmetric root margin the highlight
 * jumps to whichever heading is merely visible, which on a wide viewport is
 * usually the NEXT section rather than the one being read. Ignoring the top
 * fifth and the bottom 70% leaves a band near the top of the viewport, so the
 * active item tracks the heading you have just scrolled under.
 */
const ROOT_MARGIN = "-20% 0px -70% 0px";

export function OnThisPageRail({ items, className }: { items: readonly OutlineItem[]; className?: string }) {
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => {
        const ids = items.map((item) => item.href.replace(/^#/, ""));
        const nodes = ids.map((id) => document.getElementById(id)).filter((node): node is HTMLElement => node !== null);
        if (nodes.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Track every section's state, not just the ones in this batch:
                // an entry only fires on a CHANGE, so a section that has been
                // quietly visible the whole time is absent from `entries` and
                // would be lost if we recomputed from the callback alone.
                const visible = nodes.filter((node) => {
                    const entry = entries.find((candidate) => candidate.target === node);
                    return entry ? entry.isIntersecting : node.dataset.railVisible === "true";
                });
                for (const node of nodes) {
                    node.dataset.railVisible = String(visible.includes(node));
                }
                if (visible.length > 0) setActiveId(visible[0]!.id);
            },
            { rootMargin: ROOT_MARGIN, threshold: 0 },
        );

        for (const node of nodes) observer.observe(node);

        return () => {
            observer.disconnect();
            // Leave no marker behind on the sections themselves.
            for (const node of nodes) delete node.dataset.railVisible;
        };
    }, [items]);

    return (
        <nav aria-label="On this page" className={cn("text-[13.5px]", className)}>
            <p className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">On this page</p>

            <ul className="border-line mt-3 space-y-px border-l">
                {items.map((item) => {
                    const active = item.href === `#${activeId}`;
                    return (
                        <li key={item.href}>
                            <a
                                href={item.href}
                                aria-current={active ? "location" : undefined}
                                className={cn(
                                    "-ml-px block border-l-2 py-1.5 pl-3 transition-colors",
                                    active
                                        ? "border-accent text-fg font-medium"
                                        : "text-muted hover:text-fg border-transparent",
                                )}>
                                {item.label}
                            </a>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
