"use server";

import { RateLimited, enforceToolLimit, memberCaller, rateLimitedMessage } from "@/lib/limits";
import type { PoolCurve } from "@/lib/matching/floor";
import { poolCurveFor } from "@/lib/services/matches";
import { SiteError, setMatchingPreferences } from "@/lib/services/sites";
import { getSessionMember } from "@/lib/session";

/**
 * @file The server action behind `/app/sites`, twin of `set_matching_preferences`.
 *
 * Same service call in the same order as the tool in `src/lib/mcp/tools.ts`,
 * including the reach counts: a floor is the one setting in this product whose
 * cost is invisible until weeks of silence have gone by, so both surfaces
 * answer with what it leaves in the pool rather than just "saved".
 *
 * What was saved travels back in the action's state instead of through a
 * revalidation of the page. One member moving one slider should not re-render
 * every other card on the screen, and this card is the only thing the save
 * changes: its counts, and the chip that says what it now asks for.
 */

/**
 * What was written, plus the pool it was written against.
 *
 * The values come back rather than being assumed from the form, because the
 * chip on the closed card reads them: a card that showed what was typed rather
 * than what was stored would be wrong for exactly as long as a save was failing.
 */
export type SavedPreferences = { minPartnerDr: number; skipUnrated: boolean; curve: PoolCurve };

export type PreferencesState =
    | { status: "idle" }
    | { status: "signed_out" }
    | { status: "error"; message: string }
    | { status: "saved"; saved: SavedPreferences };

/**
 * Saves one site's floor.
 *
 * @param formData - `siteId`, `minPartnerDr`, and `skipUnrated` when ticked.
 *   An unchecked checkbox posts nothing at all, which is why its absence is
 *   read as false rather than as "leave it alone".
 */
export async function saveMatchingPreferencesAction(
    _previous: PreferencesState,
    formData: FormData,
): Promise<PreferencesState> {
    const member = await getSessionMember();
    if (!member) return { status: "signed_out" };

    const siteId = String(formData.get("siteId") ?? "");
    const minPartnerDr = Number(String(formData.get("minPartnerDr") ?? "0"));
    const skipUnrated = formData.get("skipUnrated") === "on";

    try {
        // Same bucket as the tool, keyed by the tool name: switching surface
        // must not hand anyone a second allowance.
        await enforceToolLimit("set_matching_preferences", memberCaller(member.id));

        const site = await setMatchingPreferences({ member, siteId, minPartnerDr, skipUnrated });
        return {
            status: "saved",
            saved: {
                minPartnerDr: site.minPartnerDr,
                skipUnrated: site.skipUnrated,
                curve: await poolCurveFor(site),
            },
        };
    } catch (err) {
        if (err instanceof RateLimited) return { status: "error", message: rateLimitedMessage(err) };
        if (err instanceof SiteError) return { status: "error", message: err.message };
        console.error("sites: saving matching preferences failed", err);
        return { status: "error", message: "Something went wrong on our side. Nothing was saved." };
    }
}
