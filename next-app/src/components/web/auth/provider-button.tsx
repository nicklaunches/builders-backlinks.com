import { type ProviderName, signInWithProvider } from "@/components/web/auth/auth-actions";
import { GitHubIcon, GoogleIcon } from "@/components/web/auth/provider-icons";
import { cn } from "@/components/web/cn";

/**
 * @file One "Continue with X" button, as a form.
 *
 * A form, not a link: starting a sign-in is a state change, so it is a POST.
 * That also means it carries the CSRF protection Next puts on server actions,
 * and that a crawler following links can never kick off an OAuth handshake.
 *
 * Server component, no client JavaScript. The provider and the callback travel
 * as hidden fields and are BOTH re-validated in the action, because this form
 * can be forged.
 *
 * Only design tokens here, no literal colours, so the in-flight accent change
 * lands on these buttons for free.
 */

const ICONS: Record<ProviderName, (props: { className?: string }) => React.ReactElement> = {
    google: GoogleIcon,
    github: GitHubIcon,
};

export function ProviderButton({
    provider,
    label,
    callbackUrl,
}: {
    provider: ProviderName;
    label: string;
    callbackUrl: string;
}) {
    const Icon = ICONS[provider];

    return (
        <form action={signInWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
                type="submit"
                className={cn(
                    "border-line bg-surface hover:border-line-strong hover:bg-surface-2 flex w-full items-center",
                    "justify-center gap-3 rounded-lg border px-4 py-3 text-[15px] font-medium transition-colors",
                )}>
                <Icon className="size-[18px] shrink-0" />
                Continue with {label}
            </button>
        </form>
    );
}
