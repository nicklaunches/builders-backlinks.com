import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

/**
 * @file The only place this app talks to AWS SES.
 *
 * Copied in shape from the Nick Launches app so the two stay recognisable to
 * the same reader, with one deliberate difference: the credentials are read
 * from the plain `AWS_*` names declared in `.env.example` here, not the
 * `AWS_SES_*` aliases used there. This app has no other AWS integration, so a
 * SES-specific namespace would be ceremony around a single consumer.
 *
 * The client is lazy and cached because SESv2Client resolves credentials on
 * construction. Building it at module load would make importing this file
 * (which every email template path does, transitively) fail in any environment
 * without AWS configured, including `pnpm emails:render`.
 *
 * Nothing above this module speaks AWS casing: `SesHeader` is lowercase and is
 * mapped to the SDK's `MessageHeader` at the call site.
 */

let _client: SESv2Client | null = null;

/**
 * Lazily creates and caches an SESv2 client.
 *
 * Explicit credentials are used when both `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` are present; otherwise the SDK falls back to its
 * default provider chain (instance role, SSO profile, and so on).
 *
 * @returns A process-local SESv2 client singleton.
 * @throws When no region is configured.
 */
export function getSesClient(): SESv2Client {
    if (_client) return _client;
    const region = process.env.AWS_REGION;
    if (!region) {
        throw new Error("AWS_REGION is not set");
    }
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    _client = new SESv2Client({
        region,
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    return _client;
}

/**
 * A single custom header to attach to an outgoing message.
 */
export type SesHeader = { name: string; value: string };

/**
 * Plain email payload accepted by the SES sender.
 */
export type SesEmail = {
    to: string;
    from: string;
    subject: string;
    text: string;
    html: string;
    /**
     * Extra headers, currently only `List-Unsubscribe` on digest mail.
     *
     * These ride on `Content.Simple.Headers` rather than a hand-built MIME
     * document on `Content.Raw`, which would mean owning multipart boundaries,
     * quoted-printable encoding, and header folding for the sake of one header.
     */
    headers?: SesHeader[];
    /**
     * Which template this is, e.g. `match-proposed`. Becomes the `email_type`
     * dimension on the SES event metrics, so delivery and bounce rates can be
     * read per template rather than as one undifferentiated number.
     *
     * Deliberately a coarse label and never a member address: these values
     * become CloudWatch dimension values, which are effectively public within
     * the account and cardinality-limited. A per-recipient dimension would both
     * leak addresses and blow up the metric count.
     */
    emailType?: string;
};

/**
 * The SES configuration set every send is attributed to.
 *
 * Without one, SES emits only account-wide metrics, so a member saying "I never
 * got my match email" is unanswerable on an account that also sends for other
 * projects. That was the actual situation before this existed.
 *
 * The name is hardcoded rather than an env var because it is not a secret, it
 * must match the IAM policy on `builders-backlinks-ses` (which is scoped to
 * this exact configuration-set ARN), and a typo in an env var would fail every
 * send with AccessDenied at runtime instead of at review.
 */
const CONFIGURATION_SET = "builders-backlinks";

/**
 * Sends one email through SES.
 *
 * Deliberately dumb: no rendering, no preference logic, no error swallowing.
 * `sendEmail` owns all of that, and keeping this function boring is what makes
 * it safe to call from a script or a test.
 */
export async function sendSesEmail({ to, from, subject, text, html, headers, emailType }: SesEmail): Promise<void> {
    await getSesClient().send(
        new SendEmailCommand({
            FromEmailAddress: from,
            Destination: { ToAddresses: [to] },
            ConfigurationSetName: CONFIGURATION_SET,
            // Tag values are constrained to letters, digits, dashes and
            // underscores; a stray character rejects the whole send, so the
            // label is sanitised here rather than trusted from the caller.
            EmailTags: [{ Name: "email_type", Value: (emailType ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "-") }],
            Content: {
                Simple: {
                    Subject: { Data: subject, Charset: "UTF-8" },
                    Body: {
                        Text: { Data: text, Charset: "UTF-8" },
                        Html: { Data: html, Charset: "UTF-8" },
                    },
                    // Omitted entirely when empty: SES treats an empty array as
                    // a malformed header list rather than as "no headers".
                    ...(headers && headers.length > 0
                        ? { Headers: headers.map((h) => ({ Name: h.name, Value: h.value })) }
                        : {}),
                },
            },
        }),
    );
}
