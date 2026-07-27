/**
 * @file The wordmark. A path, because the product is a two-sided trade.
 */
import { cn } from "@/components/web/cn";

export function Wordmark({ className }: { className?: string }) {
    return (
        <span className={cn("font-mono text-[15px] font-semibold tracking-tight", className)}>
            <span className="text-fg">builders</span>
            <span className="text-accent">/</span>
            <span className="text-fg">backlinks</span>
        </span>
    );
}
