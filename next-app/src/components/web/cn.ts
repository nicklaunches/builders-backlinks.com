/**
 * @file Class-name merge helper for the marketing surface.
 *
 * Lives under `src/components/web` rather than `src/lib` on purpose: `src/lib`
 * is the service/domain layer and is owned by other work in flight. Nothing in
 * the presentation layer should be adding files there.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
