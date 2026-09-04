import { AppTabs } from "@/app/app/app-tabs";
import { SiteHeader } from "@/components/web/site-header";
import { unreadCount } from "@/lib/services/threads";
import { getSessionMember } from "@/lib/session";

/**
 * @file The chrome every `/app` page shares: the site header and the tab bar.
 *
 * ONE STICKY BLOCK, NOT TWO. The header is sticky on the marketing pages by
 * itself; here it is told not to be and the two bars are pinned together, so
 * there is one z-index and one edge for content to scroll under.
 *
 * THE CHROME HEIGHT IS PUBLISHED ONCE, as `--app-chrome`. The inbox is bound to
 * the viewport rather than the document and needs to know how much of it the
 * bars take, and a constant in the inbox that had to be kept in step with two
 * class names in two other files is how the composer ends up under the fold.
 * A layout gets no pathname, so which tab is current is decided client-side in
 * `app-tabs.tsx`.
 *
 * Signed out there is no tab bar and no unread query. The pages keep rendering
 * their own sign-in prompt, because only a page knows the `callbackUrl` that
 * brings someone back to the exact thread they clicked in an email.
 */

/**
 * Header `h-14` plus tab bar `h-11`, plus the two hairlines under them.
 *
 * Keep in step with those two classes. This is the only place the number lives.
 */
const APP_CHROME_HEIGHT = "calc(3.5rem + 2.75rem + 2px)";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const member = await getSessionMember();
    const unread = member ? await unreadCount(member) : 0;

    return (
        <div className="flex min-h-dvh flex-col" style={{ "--app-chrome": APP_CHROME_HEIGHT } as React.CSSProperties}>
            <div className="sticky top-0 z-40">
                <SiteHeader sticky={false} />
                {member ? <AppTabs initialUnread={unread} /> : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </div>
    );
}
