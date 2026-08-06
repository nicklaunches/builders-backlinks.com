/**
 * @file Turning a thrown value into a line worth reading in the Worker log.
 *
 * This exists because of a specific week. `autoPair` was throwing on every
 * approval whose match score was not a whole number, and `setSiteStatus` logged
 * it with `console.error("...", err)`. In workerd that rendered as the error's
 * bare, minified stack:
 *
 *     setSiteStatus: autoPair failed after approving llmrelevance.com
 *         at t37.queryWithCache (worker.js:266181:21)
 *
 * Every word of which is true and none of which is the answer. The actual
 * message — Postgres refusing `87.16` for an integer column — was on the error
 * object, one property away, and never printed. Members were being approved and
 * silently never matched, and the log said so in a way nobody could act on.
 *
 * `cause` is the part that matters most. Drizzle wraps the driver's error, so
 * the `PostgresError` carrying the real explanation is always one level down,
 * and a formatter that stops at the top level reproduces exactly the failure
 * this file was written to prevent.
 */

/** How deep to follow `cause` before assuming the chain is a cycle. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Formats a thrown value for a log line: message first, then its causes.
 *
 * Deliberately returns a string rather than logging. The caller owns the
 * prefix, and a formatter that also wrote to the console could not be used in
 * the branch that needs to add context to it.
 *
 * @param err - Anything a `catch` can receive, including non-Errors.
 * @returns A single line, safe to interpolate. Never throws.
 */
export function errorDetail(err: unknown): string {
    const parts: string[] = [];
    let current = err;

    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current != null; depth++) {
        parts.push(describe(current));

        // Postgres puts the useful specifics in fields of its own rather than
        // in the message: which column, which constraint, which value.
        const extra = pgDetail(current);
        if (extra) parts.push(extra);

        const next: unknown = current instanceof Error ? current.cause : undefined;
        if (next === undefined || next === current) break;
        current = next;
    }

    return parts.join(" | ");
}

function describe(value: unknown): string {
    if (value instanceof Error) {
        const name = value.name || "Error";
        return value.message ? `${name}: ${value.message}` : name;
    }
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/**
 * The `PostgresError` fields worth having, when they are present.
 *
 * Read defensively off an unknown shape rather than by importing the driver's
 * error class: this module is imported by routes that must not depend on which
 * driver is underneath, and a `postgres` error and a `pg` error carry these
 * under the same names anyway.
 */
function pgDetail(value: unknown): string | null {
    if (typeof value !== "object" || value === null) return null;
    const e = value as Record<string, unknown>;
    const fields = ["code", "detail", "column", "constraint", "table"] as const;
    const found = fields
        .map((f) => (typeof e[f] === "string" && e[f] ? `${f}=${e[f] as string}` : null))
        .filter((s): s is string => s !== null);
    return found.length > 0 ? found.join(" ") : null;
}
