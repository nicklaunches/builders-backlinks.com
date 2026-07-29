import { cn } from "@/components/web/cn";

/**
 * @file The pasteable-command body used inside every terminal panel.
 *
 * Extracted because the landing page and `/app/key` render the same thing: a
 * monospace block that scrolls sideways rather than wrapping, because wrapping
 * a shell command turns it into something that no longer works when pasted.
 * The two had drifted into separate copies, and only one of them dimmed
 * comments or hid the scrollbar.
 *
 * Always pair it with the two classes it depends on but cannot set itself,
 * since they belong to the scroll container rather than the content:
 *
 *     <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
 *         <SnippetBody snippet={…} />
 *     </div>
 *
 * `min-w-max` here is what makes the line refuse to wrap; `min-w-0` on the
 * parent is what lets the flex item shrink so the overflow actually scrolls.
 * Remove either and the block silently starts wrapping instead.
 *
 * Use `items-center` on the row holding this and the copy button. The common
 * case is a one-line command next to a taller bordered button, and top-aligning
 * those reads as a misalignment.
 */
export function SnippetBody({ snippet, className }: { snippet: string; className?: string }) {
    return (
        <pre className={cn("min-w-max font-mono text-[12.5px] leading-[1.75] sm:text-[13px]", className)}>
            <code>
                {snippet.split("\n").map((line, index) => {
                    // Comment lines are context, not something to paste and run,
                    // so they recede. Checked on the trimmed line because they
                    // are usually indented inside a JSON or YAML sample.
                    const isComment = line.trimStart().startsWith("#");
                    return (
                        <span
                            key={index}
                            className={cn("block whitespace-pre", isComment ? "text-term-dim" : "text-term-bright")}>
                            {/* An empty line collapses to zero height without this. */}
                            {line === "" ? " " : line}
                        </span>
                    );
                })}
            </code>
        </pre>
    );
}
