import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    compress: true,
    poweredByHeader: false,
    async headers() {
        return [
            // The MCP endpoint is called cross-origin by agent clients and by
            // the MCP Inspector. CORS must allow the MCP protocol headers.
            {
                source: "/api/:transport(mcp|sse)",
                headers: [
                    { key: "Access-Control-Allow-Origin", value: "*" },
                    { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
                    {
                        key: "Access-Control-Allow-Headers",
                        value: "Content-Type, Authorization, mcp-session-id, mcp-protocol-version",
                    },
                    { key: "Access-Control-Expose-Headers", value: "mcp-session-id" },
                ],
            },
        ];
    },
};

export default nextConfig;
