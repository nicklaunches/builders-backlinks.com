import { AwsClient } from "aws4fetch";

/**
 * @file The only place this app talks to AWS SES.
 *
 * Copied in shape from the Nick Launches app so the two stay recognisable to
 * the same reader, with one deliberate difference: the credentials are read
 * from the plain `AWS_*` names declared in `.env.example` here, not the
 * `AWS_SES_*` aliases used there. This app has no other AWS integration, so a
 * SES-specific namespace would be ceremony around a single consumer.
 *
 * ## Why this is SigV4 over `fetch` and not `@aws-sdk/client-sesv2`
 *
 * The SDK cannot send from workerd. Every `send()` throws
 * `[unenv] fs.readFile is not implemented yet!`, from
 * `loadSharedConfigFiles` trying to read `~/.aws/config`. Passing explicit
 * `region` and `credentials` does not avoid it: the client's node runtime
 * config registers file-backed lazy providers for `defaultsMode`, `retryMode`,
 * `useDualstackEndpoint` and others, and the first `send()` resolves all of
 * them. There is no combination of constructor options that reliably turns
 * that off, and pinning today's list would break again the next time the SDK
 * adds a provider — silently, because a failed send is caught and logged.
 *
 * That is not a hypothetical. It is what shipped: the app sent nothing in
 * production for its entire life, and the error was invisible because the
 * notification promise was cancelled before it could throw. See rule 1 in
 * `notify.ts` for that half of the story.
 *
 * `aws4fetch` signs a plain `fetch` with SubtleCrypto and touches no Node API,
 * so it works on workerd by construction rather than by configuration. It also
 * removes the largest dependency in the bundle. The cost is that this file now
 * owns the request shape: SES v2 `SendEmail` takes the same JSON body the SDK
 * command did, so the payload below is the SDK's input verbatim.
 *
 * The client is built per call. It holds no I/O object, only strings and a
 * derived-key cache, so a module-level singleton would be safe here in a way
 * the database handle is not — but it would also be the same shape this repo
 * has been bitten by twice, for a saving of nothing on a few sends a day.
 * Building it per call also means credentials are read at call time, which is
 * what makes `pnpm emails:render` and the unit tests importable without AWS
 * configured at all.
 *
 * Nothing above this module speaks AWS casing: `SesHeader` is lowercase and is
 * mapped to the wire format at the call site.
 */

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
 * Builds a SigV4-signing `fetch` for SES in the configured region.
 *
 * @throws When the region or either credential is missing. Unlike the SDK,
 *         there is no ambient provider chain to fall back to, so an incomplete
 *         configuration has to be an error rather than a slow discovery.
 */
function getSesClient(): { client: AwsClient; region: string } {
    const region = process.env.AWS_REGION;
    if (!region) {
        throw new Error("AWS_REGION is not set");
    }
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) {
        throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must both be set");
    }
    return { client: new AwsClient({ accessKeyId, secretAccessKey, region, service: "ses" }), region };
}

/**
 * Sends one email through SES.
 *
 * Deliberately dumb: no rendering, no preference logic, no error swallowing.
 * `sendEmail` owns all of that, and keeping this function boring is what makes
 * it safe to call from a script or a test.
 *
 * @throws When SES answers with a non-2xx. The body is included in the message:
 *         SES puts the useful part (`MessageRejected`, `AccessDeniedException`
 *         and which ARN it wanted) there, and a bare status code would send the
 *         next person reading a log straight back to the AWS console.
 */
export async function sendSesEmail({ to, from, subject, text, html, headers, emailType }: SesEmail): Promise<void> {
    const { client, region } = getSesClient();

    const response = await client.fetch(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
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
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`SES returned ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
    }
}
