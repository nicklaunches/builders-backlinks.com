/**
 * @file Shared bearer check for the scheduled routes.
 *
 * The cron endpoints send mail and mutate link state, so they are not
 * something the open internet gets to trigger. Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`, and this rejects anything else.
 *
 * Fails CLOSED when `CRON_SECRET` is unset, which is the opposite of how the
 * rate limiter behaves and deliberately so. An unconfigured rate limiter should
 * let real traffic through; an unconfigured cron endpoint that anyone can hit
 * would let a stranger drain the send quota.
 */

/** True when the request carries the shared cron secret. */
export function isAuthorizedCron(request: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error("cron: CRON_SECRET is not set, refusing the request");
        return false;
    }
    return request.headers.get("authorization") === `Bearer ${secret}`;
}
