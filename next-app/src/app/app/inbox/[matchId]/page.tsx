import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { InboxShell, InboxSignedOut } from "@/app/app/inbox/inbox-shell";
import { asJson } from "@/app/app/inbox/shared";
import { ThreadPane } from "@/app/app/inbox/thread-pane";
import type { ExchangeMember } from "@/lib/db/schema";
import { ThreadError, getThread, listThreads } from "@/lib/services/threads";
import { getSessionMember } from "@/lib/session";

/**
 * @file `/app/inbox/<match>` — one open thread.
 *
 * The URL the reply email links to, which is why the thread is a route rather
 * than client state: a member arriving from their mail lands on the
 * conversation itself, signed in or not.
 *
 * A thread that is missing, or belongs to someone else, is a 404 either way.
 * Distinguishing the two would confirm that an id exists to whoever guessed it.
 */

export const metadata: Metadata = {
    title: "Inbox",
    robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const MATCH_ID = z.uuid();

export default async function ThreadPage({ params }: { params: Promise<{ matchId: string }> }) {
    const { matchId } = await params;
    // The same check the routes make. A malformed id would otherwise reach
    // Postgres as a uuid cast error, which is a 500, and a guessed URL deserves
    // the same 404 as a real id that is not yours.
    if (!MATCH_ID.safeParse(matchId).success) notFound();

    // The callback is this thread, not the inbox: the reply email links here,
    // and a member who signs in from it should land on the conversation.
    const member = await getSessionMember();
    if (!member) return <InboxSignedOut callbackUrl={`/app/inbox/${matchId}`} />;

    // The fetch is what can fail, so only the fetch is guarded: JSX built inside
    // a try does not have its render errors caught by it, and React says so.
    const loaded = await load(member, matchId);
    if (!loaded) notFound();

    return (
        <InboxShell threads={loaded.threads} selectedId={matchId}>
            <ThreadPane initial={asJson(loaded.thread)} />
        </InboxShell>
    );
}

/** The list and the open thread, or null when the thread is not this member's. */
async function load(member: ExchangeMember, matchId: string) {
    try {
        const [threads, thread] = await Promise.all([listThreads(member), getThread({ member, matchId })]);
        return { threads, thread };
    } catch (err) {
        if (err instanceof ThreadError) return null;
        throw err;
    }
}
