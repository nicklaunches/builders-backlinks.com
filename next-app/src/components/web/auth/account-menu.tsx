"use client";

import { ChevronDown, Globe, Key, LayoutGrid, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { signOutAction } from "@/components/web/auth/auth-actions";
import { cn } from "@/components/web/cn";

/**
 * @file Who you are signed in as, and the way out.
 *
 * Replaces a bare Sign out button, which spent the most prominent slot in the
 * header on the one action a member almost never wants and said nothing about
 * whose account they were in — a real question on a product people reach from
 * an email, sometimes in the wrong browser profile.
 *
 * SIGNING OUT IS STILL A POST. The menu item is a form submitting the same
 * server action, not a link: a GET sign-out can be triggered by anything that
 * fetches a URL, including a link scanner in somebody's mail client.
 *
 * The only client component in the header. It closes on Escape, on a click
 * outside, and on its own items — a soft navigation leaves this markup mounted,
 * so a menu that did not close on the click would still be open on the page it
 * just opened.
 */

export type AccountUser = {
    name: string | null;
    email: string | null;
    image: string | null;
};

const ITEM = "flex w-full items-center gap-2.5 px-3 py-2 text-[13.5px] text-left transition-colors hover:bg-surface-2";

export function AccountMenu({ user }: { user: AccountUser }) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const root = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;

        function onKey(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }
        function onPointer(event: MouseEvent) {
            if (!root.current?.contains(event.target as Node)) setOpen(false);
        }

        document.addEventListener("keydown", onKey);
        document.addEventListener("mousedown", onPointer);
        return () => {
            document.removeEventListener("keydown", onKey);
            document.removeEventListener("mousedown", onPointer);
        };
    }, [open]);

    const label = user.name ?? user.email ?? "Account";
    const close = () => setOpen(false);

    return (
        <div ref={root} className="relative">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-haspopup="menu"
                aria-controls={menuId}
                className={cn(
                    "border-line hover:border-line-strong hover:bg-surface-2 flex items-center gap-2 rounded-sm border py-1 pr-2 pl-1 transition-colors",
                    open && "border-line-strong bg-surface-2",
                )}>
                <Avatar user={user} />
                <span className="text-muted hidden max-w-[12ch] truncate text-[13.5px] sm:inline">{label}</span>
                <ChevronDown aria-hidden="true" className="text-muted size-3.5" />
            </button>

            {open ? (
                <div
                    id={menuId}
                    role="menu"
                    aria-label="Account"
                    className="border-line bg-surface absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-sm border shadow-lg">
                    <div className="border-line border-b px-3 py-2.5">
                        <p className="truncate text-[13.5px] font-medium">{label}</p>
                        {user.email && user.email !== label ? (
                            <p className="text-muted truncate font-mono text-[11.5px]">{user.email}</p>
                        ) : null}
                    </div>

                    <Link href="/app" role="menuitem" className={ITEM} onClick={close}>
                        <LayoutGrid aria-hidden="true" className="text-muted size-4" />
                        Dashboard
                    </Link>
                    <Link href="/app/sites" role="menuitem" className={ITEM} onClick={close}>
                        <Globe aria-hidden="true" className="text-muted size-4" />
                        Your sites
                    </Link>
                    <Link href="/app/key" role="menuitem" className={ITEM} onClick={close}>
                        <Key aria-hidden="true" className="text-muted size-4" />
                        API key
                    </Link>

                    <form action={signOutAction} className="border-line border-t">
                        <button type="submit" role="menuitem" className={ITEM}>
                            <LogOut aria-hidden="true" className="text-muted size-4" />
                            Sign out
                        </button>
                    </form>
                </div>
            ) : null}
        </div>
    );
}

/**
 * The provider's picture, or the first letter of whatever we know them by.
 *
 * A plain `<img>`: this is a remote avatar on a domain Next is not configured
 * to optimise, and running it through the loader would mean maintaining a
 * remote-patterns allowlist for Google and GitHub CDNs.
 */
function Avatar({ user }: { user: AccountUser }) {
    if (user.image) {
        return (
            // A remote avatar on a host Next is not configured to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={user.image}
                alt=""
                width={24}
                height={24}
                referrerPolicy="no-referrer"
                className="size-6 shrink-0 rounded-sm object-cover"
            />
        );
    }

    const initial = (user.name ?? user.email ?? "?").trim().charAt(0).toUpperCase();
    return (
        <span
            aria-hidden="true"
            className="bg-surface-2 text-muted grid size-6 shrink-0 place-items-center rounded-sm font-mono text-[11px] font-semibold">
            {initial}
        </span>
    );
}
