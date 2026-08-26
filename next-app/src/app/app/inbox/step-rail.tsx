import { Check } from "lucide-react";

import { cn } from "@/components/web/cn";
import type { ThreadStepView } from "@/lib/inbox";

/**
 * @file The four-step rail across the top of a thread.
 *
 * Presentational only: `services/threads.ts` decides which step is current, so
 * this cannot disagree with the tasks below it. A closed thread renders the same
 * rail dimmed, with a banner over it, rather than a different component — the
 * shape of what was being attempted is still the clearest thing to show.
 */

export function StepRail({ steps, muted }: { steps: ThreadStepView[]; muted?: boolean }) {
    return (
        <ol className={cn("border-line grid grid-cols-4 overflow-hidden rounded-sm border", muted && "opacity-55")}>
            {steps.map((step, index) => (
                <li
                    key={step.step}
                    aria-current={step.status === "current" ? "step" : undefined}
                    className={cn(
                        "flex items-center gap-2 px-3 py-2.5",
                        index > 0 && "border-line border-l",
                        step.status === "current" ? "bg-accent-soft" : "bg-surface",
                    )}>
                    <span
                        className={cn(
                            "flex size-[18px] shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold",
                            step.status === "done"
                                ? "border-term-ok/50 bg-term-ok/15 text-term-ok"
                                : step.status === "current"
                                  ? "border-accent bg-accent text-accent-fg"
                                  : "border-line text-muted",
                        )}>
                        {step.status === "done" ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                    </span>
                    <span
                        className={cn(
                            "truncate text-[12.5px]",
                            step.status === "todo" ? "text-muted" : "text-fg font-medium",
                        )}>
                        {step.label}
                    </span>
                </li>
            ))}
        </ol>
    );
}
