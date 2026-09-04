import type { Metadata } from "next";

import { InboxShell, InboxSignInPrompt, NoThreadSelected } from "@/app/app/inbox/inbox-shell";
import { listThreads } from "@/lib/services/threads";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app/inbox` — the list with nothing open.
 *
 * On a wide screen this is the two-pane inbox with an empty right side; on a
 * phone it is just the list. Both are the same component, differing only in
 * which pane the layout hides.
 */

export const metadata: Metadata = {
    title: "Inbox",
    description: "Your link exchanges, one thread each.",
    alternates: { canonical: "/app/inbox" },
    robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function InboxPage() {
    const member = await getSessionMember();
    if (!member) return <InboxSignInPrompt />;

    const threads = await listThreads(member);

    return (
        <InboxShell threads={threads} selectedId={null}>
            <NoThreadSelected hasThreads={threads.length > 0} />
        </InboxShell>
    );
}
