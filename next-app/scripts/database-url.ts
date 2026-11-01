/**
 * @file Tells a database on this machine apart from production reached through a tunnel.
 *
 * Production Postgres lives on the shared Hetzner box and listens on its own
 * loopback only, so every client outside Cloudflare reaches it through a port
 * forwarded to localhost: `ssh -fN db-tunnel` on a workstation, `cloudflared
 * access tcp` in the deploy workflow. The host alone therefore says nothing; the
 * port is what separates a throwaway local Postgres from the live one.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"]);

/** Localhost ports that forward to production. Keep in step with `db-tunnel` in ~/.ssh/config and deploy.yml. */
const PRODUCTION_TUNNEL_PORTS = new Set(["15432"]);

/** True when the URL is a localhost port that forwards to production. */
export function isProductionTunnel(url: URL): boolean {
    return LOCAL_HOSTS.has(url.hostname) && PRODUCTION_TUNNEL_PORTS.has(url.port);
}

/** True only for a Postgres on this machine that is not a tunnel to production. */
export function isLocalDatabase(url: URL): boolean {
    return LOCAL_HOSTS.has(url.hostname) && !isProductionTunnel(url);
}
