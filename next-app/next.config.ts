import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    compress: true,
    poweredByHeader: false,

    // No CORS block for /api/mcp on purpose. The MCP transport sets its own
    // Access-Control headers, including the Mcp-Method and Mcp-Name entries the
    // 2026 protocol revision uses. Next's headers() OVERRIDE the handler's
    // rather than merging with them, so a hand-maintained list here could only
    // ever drift behind the protocol and silently break clients.
};

export default nextConfig;
