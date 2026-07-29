/**
 * @file Ambient types for the Cloudflare build: the generated worker bundle,
 * and the bindings on the OpenNext context.
 *
 * This file has no top-level import or export, so it is a global script and the
 * declarations below merge straight into global scope. A `declare global`
 * wrapper would be wrong here, and fails silently rather than erroring.
 */

/**
 * Feeds the bindings into the type OpenNext hands back from
 * `getCloudflareContext()`.
 *
 * `wrangler types` writes a global `Env` from wrangler.jsonc, but OpenNext
 * declares its own empty `CloudflareEnv` and has no way to know about it, so
 * without this every binding reads as a property that does not exist. Extending
 * one from the other keeps wrangler.jsonc the single source of truth: add a
 * binding there, rerun `wrangler types`, and it is typed on the context too.
 *
 * The empty body is the entire point, so the lint rule against it is wrong
 * here. This has to stay an `interface` rather than `type CloudflareEnv = Env`:
 * OpenNext declares its own `interface CloudflareEnv` in global scope, and only
 * an interface merges with it. A type alias collides instead.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface CloudflareEnv extends Env {}

/**
 * The bundle that `opennextjs-cloudflare build` generates.
 *
 * `worker.ts` imports this as `"open-next/worker"`, a name that resolves
 * through the `alias` entry in wrangler.jsonc to `.open-next/worker.js` at
 * bundle time. It is deliberately NOT imported by its real relative path.
 *
 * The reason is that `.open-next/` is generated and gitignored, so it is absent
 * in a clean checkout and present after a build, and TypeScript answers
 * differently in those two states. A relative ambient declaration
 * (`declare module "./.open-next/worker.js"`) is honoured only while the path
 * does not exist on disk; once the directory appears, TS attempts real
 * resolution, finds nothing inside, and reports TS2307 instead of falling back.
 * That was observed directly here: `tsc --noEmit` passed, then failed after a
 * build created an empty `.open-next/`, with no source change in between.
 *
 * A bare module name has no such fallback behaviour. This declaration always
 * matches, so type-checking gives the same answer before and after a build, and
 * on CI where no build has run at all.
 */
declare module "open-next/worker" {
    const handler: {
        fetch: (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>;
    };
    export default handler;

    // Durable Objects that OpenNext defines and wrangler.jsonc binds. They are
    // re-exported unchanged; the Worker runtime needs them on the entry module.
    export const DOQueueHandler: unknown;
    export const DOShardedTagCache: unknown;
    export const BucketCachePurge: unknown;
}
