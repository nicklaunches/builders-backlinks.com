/**
 * @file One date format for the key page.
 *
 * Fixed locale and fixed time zone on purpose. A date rendered with the
 * server's locale and rehydrated with the browser's is a hydration mismatch,
 * and the two places a key date appears (the server render and the result of
 * the issue action) must agree exactly.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
});

/**
 * Formats a timestamp as `27 Jul 2026` in UTC.
 *
 * @returns The formatted date, or null when there is no timestamp.
 */
export function formatKeyDate(value: Date | null | undefined): string | null {
    return value ? DATE_FORMAT.format(value) : null;
}
