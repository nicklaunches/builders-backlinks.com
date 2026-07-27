/**
 * @file Accessible tab strip used twice in the hero (client picker, view picker).
 *
 * Implements the WAI-ARIA tabs pattern with a roving tabindex: exactly one tab
 * is in the tab order, and Left/Right/Home/End move both selection and focus.
 * Real `<button>` elements, so Enter/Space work for free.
 */

"use client";

import { useRef } from "react";

import { cn } from "@/components/web/cn";

export type TabItem<T extends string> = {
    id: T;
    label: string;
};

type TabListProps<T extends string> = {
    /** Accessible name for the strip, e.g. "Agent client". */
    label: string;
    /** Prefix for the generated tab/panel ids. Must be unique per strip. */
    idBase: string;
    items: readonly TabItem<T>[];
    value: T;
    onChange: (next: T) => void;
    variant?: "solid" | "underline";
    className?: string;
};

export function tabId(idBase: string, id: string): string {
    return `${idBase}-tab-${id}`;
}

export function panelId(idBase: string, id: string): string {
    return `${idBase}-panel-${id}`;
}

export function TabList<T extends string>({
    label,
    idBase,
    items,
    value,
    onChange,
    variant = "solid",
    className,
}: TabListProps<T>) {
    const refs = useRef<Array<HTMLButtonElement | null>>([]);

    function move(nextIndex: number) {
        const item = items[nextIndex];
        if (!item) return;
        onChange(item.id);
        refs.current[nextIndex]?.focus();
    }

    function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        const current = items.findIndex((item) => item.id === value);
        if (current < 0) return;

        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                event.preventDefault();
                move((current + 1) % items.length);
                break;
            case "ArrowLeft":
            case "ArrowUp":
                event.preventDefault();
                move((current - 1 + items.length) % items.length);
                break;
            case "Home":
                event.preventDefault();
                move(0);
                break;
            case "End":
                event.preventDefault();
                move(items.length - 1);
                break;
            default:
                break;
        }
    }

    return (
        <div
            role="tablist"
            aria-label={label}
            aria-orientation="horizontal"
            onKeyDown={onKeyDown}
            className={cn(
                "flex items-center gap-1 overflow-x-auto",
                variant === "solid" && "rounded-lg p-1",
                className,
            )}>
            {items.map((item, index) => {
                const selected = item.id === value;
                return (
                    <button
                        key={item.id}
                        ref={(node) => {
                            refs.current[index] = node;
                        }}
                        type="button"
                        role="tab"
                        id={tabId(idBase, item.id)}
                        aria-selected={selected}
                        aria-controls={panelId(idBase, item.id)}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => onChange(item.id)}
                        className={cn(
                            "shrink-0 font-mono whitespace-nowrap transition-colors",
                            variant === "solid" &&
                                "rounded-md px-3 py-1.5 text-[12.5px] tracking-tight sm:text-[13px]",
                            variant === "solid" &&
                                (selected
                                    ? "bg-term-bg text-term-bright shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]"
                                    : "text-term-dim hover:text-term-fg"),
                            variant === "underline" &&
                                "rounded-none border-b-2 px-3 py-2 text-[12px] tracking-wide lowercase sm:text-[12.5px]",
                            variant === "underline" &&
                                (selected
                                    ? "border-term-ok text-term-bright"
                                    : "border-transparent text-term-dim hover:text-term-fg"),
                        )}>
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
}
