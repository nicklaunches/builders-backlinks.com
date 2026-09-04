"use client";

import { AlertTriangle, KeyRound, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

import { type IssueKeyState, issueKeyAction } from "@/app/app/key/actions";
import { cn } from "@/components/web/cn";
import { CopyButton } from "@/components/web/copy-button";
import { SnippetBody } from "@/components/web/snippet-body";
import { track } from "@/lib/analytics";

/**
 * @file The key page's interactive half.
 *
 * The one-time reveal is the whole design constraint. Only the SHA-256 of a key
 * is stored, so the plaintext exists in exactly one place: the return value of
 * `issueKeyAction`, held in this component's state. It is never rendered from a
 * server load, because there is nothing on the server to render it from.
 *
 * Given a secret you can only show once, the most useful thing to show is not
 * the secret. It is the complete, already-substituted install command, so the
 * member's single copy is the thing they actually need, not a token they then
 * have to splice into a snippet from somewhere else. That line is the reason
 * this page exists.
 */

/**
 * The production MCP endpoint, matching the landing page and the sign-in hint
 * the MCP tools print. Deliberately not derived from the current origin: a key
 * copied from a preview deployment still has to point at the real server.
 */
const MCP_URL = "https://builders-backlinks.com/api/mcp";

function claudeCommand(key: string): string {
    return `claude mcp add --transport http builders-backlinks ${MCP_URL} --header "Authorization: Bearer ${key}"`;
}

function cursorConfig(key: string): string {
    return `{
    "mcpServers": {
        "builders-backlinks": {
            "url": "${MCP_URL}",
            "headers": {
                "Authorization": "Bearer ${key}"
            }
        }
    }
}`;
}

const INITIAL: IssueKeyState = { status: "idle" };

export type KeyPanelProps = {
    /** Metadata from the member document. Never contains a key. */
    initial: { issued: boolean; issuedAt: string | null; lastUsedAt: string | null };
};

export function KeyPanel({ initial }: KeyPanelProps) {
    const [state, formAction, pending] = useActionState(issueKeyAction, INITIAL);
    const [dismissed, setDismissed] = useState(false);

    if (state.status === "issued" && !dismissed) {
        return <Reveal state={state} onDismiss={() => setDismissed(true)} />;
    }

    const issued = state.status === "issued" || initial.issued;
    const issuedAt = state.status === "issued" ? state.issuedAt : initial.issuedAt;
    const lastUsedAt = state.status === "issued" ? null : initial.lastUsedAt;

    const error =
        state.status === "error"
            ? state.message
            : state.status === "signed_out"
              ? "Your session expired. Sign in again to issue a key."
              : null;

    return (
        <div className="flex flex-col gap-6">
            {issued ? (
                <ExistingKey issuedAt={issuedAt} lastUsedAt={lastUsedAt} formAction={formAction} pending={pending} />
            ) : (
                <Generate formAction={formAction} pending={pending} />
            )}

            {error ? (
                <p
                    role="alert"
                    className="border-line bg-surface-2 flex items-start gap-2.5 rounded-sm border p-4 text-[13.5px] leading-relaxed">
                    <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                </p>
            ) : null}
        </div>
    );
}

/** The state before a member has any key: what one is for, and the button that mints it. */
function Generate({ formAction, pending }: { formAction: () => void; pending: boolean }) {
    return (
        <section aria-labelledby="generate-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <span className="border-line bg-surface-2 text-accent mb-4 inline-flex size-10 items-center justify-center rounded-sm border">
                <KeyRound aria-hidden="true" className="size-5" />
            </span>

            <h2 id="generate-heading" className="text-[1.25rem] font-semibold tracking-[-0.02em]">
                Generate your key
            </h2>
            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                One key, one member. It goes in an <code className="text-fg font-mono text-[13px]">Authorization</code>{" "}
                header and it is the only secret involved. Nothing is installed on your machine: the exchange is an HTTP
                MCP server.
            </p>
            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                We store a hash of it, never the key itself, so the next screen is the only time it can be read. Have
                somewhere to paste it ready.
            </p>

            <form action={formAction} className="mt-6">
                <button
                    type="submit"
                    disabled={pending}
                    className={cn(
                        "bg-accent text-accent-fg hover:bg-accent-hover inline-flex items-center justify-center gap-2",
                        "rounded-sm px-6 py-3 text-[15px] font-semibold transition-colors",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                    )}>
                    {pending ? (
                        <>
                            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                            Generating
                        </>
                    ) : (
                        "Generate key"
                    )}
                </button>
            </form>
        </section>
    );
}

/**
 * The one screen the plaintext key is ever readable on.
 *
 * Only a hash is stored, so there is no second chance and the warning is a
 * `role="alert"` that cannot be scrolled past.
 */
function Reveal({ state, onDismiss }: { state: Extract<IssueKeyState, { status: "issued" }>; onDismiss: () => void }) {
    const command = claudeCommand(state.plaintext);
    const cursor = cursorConfig(state.plaintext);

    useEffect(() => track("issue_key"), []);

    return (
        <div className="flex flex-col gap-6">
            {/* The warning has to be impossible to scroll past. */}
            <section
                role="alert"
                aria-labelledby="reveal-heading"
                className="border-accent/40 bg-accent-soft rounded-sm border p-5 sm:p-6">
                <p className="flex items-center gap-2.5 text-[15px] font-semibold">
                    <ShieldAlert aria-hidden="true" className="text-accent size-5 shrink-0" />
                    <span id="reveal-heading">This is the only time this key will ever be shown.</span>
                </p>
                <p className="text-muted mt-2.5 text-[14px] leading-relaxed">
                    We store a hash of it, not the key, so we genuinely cannot show it to you again, and neither can
                    anyone who breaks into the database. Copy the install command below now. If you lose it, generating
                    a new one takes one click and instantly stops the old one working.
                </p>
                {state.replaced ? (
                    <p className="text-muted mt-2.5 text-[14px] leading-relaxed">
                        Your previous key stopped working the moment this one was created. Any agent still configured
                        with it will start failing until you paste the new command.
                    </p>
                ) : null}
            </section>

            {/* The single most useful line on the page: complete, key already in it. */}
            <Snippet
                eyebrow="Claude Code · run this once, in any terminal"
                label="Claude Code install command"
                value={command}
                footnote="Add --scope user to make the server available in every project instead of just this one."
                primary
            />

            <Snippet
                eyebrow="Cursor · create or edit .cursor/mcp.json"
                label="Cursor config"
                value={cursor}
                footnote="Use ~/.cursor/mcp.json instead if you want the server in every project."
            />

            <Snippet eyebrow="The key on its own" label="API key" value={state.plaintext} />

            <div className="border-line bg-surface flex flex-col gap-3 rounded-sm border p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted text-[13.5px] leading-relaxed">
                    Saved it somewhere? Hiding it does not revoke it, it just takes it off this screen.
                </p>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="border-line hover:border-line-strong hover:bg-surface-2 inline-flex shrink-0 items-center justify-center rounded-sm border px-5 py-2.5 text-[14px] font-medium transition-colors">
                    I have saved it, hide it
                </button>
            </div>

            <p className="text-muted text-[13.5px] leading-relaxed">
                Once the server is added, say <span className="text-fg font-mono">&ldquo;trade a link&rdquo;</span> in
                any session. Start with <code className="text-fg font-mono">submit_site</code>; it drafts your listing
                and shows it to you before anything is published.
            </p>
        </div>
    );
}

function Snippet({
    eyebrow,
    label,
    value,
    footnote,
    primary = false,
}: {
    eyebrow: string;
    label: string;
    value: string;
    footnote?: string;
    primary?: boolean;
}) {
    return (
        <section
            className={cn(
                "border-term-line bg-term-bg overflow-hidden rounded-sm border",
                primary && "shadow-2xl shadow-black/20",
            )}>
            <div className="border-term-line bg-term-chrome flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5">
                <span className="text-term-dim font-mono text-[11px] tracking-[0.14em] uppercase">{eyebrow}</span>
                {primary ? (
                    <span className="border-term-ok/40 bg-term-ok/10 text-term-ok rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase">
                        Ready to paste
                    </span>
                ) : null}
            </div>

            {/* items-center and scrollbar-none, matching the install block on the
                landing page. Both panels render the same thing, so they share
                SnippetBody rather than keeping two copies that drift. */}
            <div className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1 scrollbar-none overflow-x-auto">
                    <SnippetBody snippet={value} />
                </div>
                <CopyButton value={value} label={label} />
            </div>

            {footnote ? (
                <p className="border-term-line text-term-dim border-t px-4 py-2.5 text-[12px] leading-relaxed">
                    {footnote}
                </p>
            ) : null}
        </section>
    );
}

/** The returning state: when the key was issued and last used, and a confirmed regenerate. */
function ExistingKey({
    issuedAt,
    lastUsedAt,
    formAction,
    pending,
}: {
    issuedAt: string | null;
    lastUsedAt: string | null;
    formAction: () => void;
    pending: boolean;
}) {
    const [confirming, setConfirming] = useState(false);

    return (
        <section aria-labelledby="existing-heading" className="border-line bg-surface rounded-sm border p-6 sm:p-8">
            <span className="border-line bg-surface-2 text-accent mb-4 inline-flex size-10 items-center justify-center rounded-sm border">
                <KeyRound aria-hidden="true" className="size-5" />
            </span>

            <h2 id="existing-heading" className="text-[1.25rem] font-semibold tracking-[-0.02em]">
                You have a key
            </h2>
            <p className="text-muted mt-3 text-[14.5px] leading-relaxed">
                We only hold a hash of it, so it cannot be shown again, not to you and not to us. If it is not in your
                agent config any more, generate a new one.
            </p>

            <dl className="border-line mt-6 grid gap-px overflow-hidden rounded-sm border sm:grid-cols-2">
                <div className="bg-surface-2/60 p-4">
                    <dt className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Issued</dt>
                    <dd className="mt-1.5 font-mono text-[14px]">{issuedAt ?? "unknown"}</dd>
                </div>
                <div className="bg-surface-2/60 p-4">
                    <dt className="text-muted font-mono text-[11px] tracking-[0.14em] uppercase">Last used</dt>
                    <dd className="mt-1.5 font-mono text-[14px]">{lastUsedAt ?? "never"}</dd>
                    {lastUsedAt ? null : (
                        <p className="text-muted mt-1.5 text-[12.5px] leading-relaxed">
                            No MCP call has authenticated with it yet.
                        </p>
                    )}
                </div>
            </dl>

            {confirming ? (
                <div className="border-line bg-surface-2 mt-6 rounded-sm border p-5">
                    <p className="flex items-start gap-2.5 text-[14.5px] font-semibold">
                        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        <span>Your current key stops working immediately.</span>
                    </p>
                    <p className="text-muted mt-2.5 text-[14px] leading-relaxed">
                        There is one key per member, so generating a new one revokes the old one in the same instant.
                        Every agent still configured with the old key starts failing until you paste the new install
                        command. The new key is shown once, on the next screen.
                    </p>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                        <form action={formAction}>
                            <button
                                type="submit"
                                disabled={pending}
                                className={cn(
                                    "bg-accent text-accent-fg hover:bg-accent-hover inline-flex w-full items-center justify-center gap-2",
                                    "rounded-sm px-5 py-2.5 text-[14.5px] font-semibold transition-colors sm:w-auto",
                                    "disabled:cursor-not-allowed disabled:opacity-60",
                                )}>
                                {pending ? (
                                    <>
                                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                                        Regenerating
                                    </>
                                ) : (
                                    "Yes, revoke it and issue a new key"
                                )}
                            </button>
                        </form>
                        <button
                            type="button"
                            onClick={() => setConfirming(false)}
                            disabled={pending}
                            className="border-line hover:border-line-strong hover:bg-surface inline-flex items-center justify-center rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors disabled:opacity-60">
                            Keep my current key
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="border-line hover:border-line-strong hover:bg-surface-2 mt-6 inline-flex items-center justify-center gap-2 rounded-sm border px-5 py-2.5 text-[14.5px] font-medium transition-colors">
                    <RotateCcw aria-hidden="true" className="size-4" />
                    Regenerate key
                </button>
            )}
        </section>
    );
}
