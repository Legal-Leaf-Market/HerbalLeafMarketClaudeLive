/** @type {import('next').NextConfig} */

// Baseline hardening headers applied to every response on the deployed app.
// (The v0 preview strips framing/CSP so the app still renders in the iframe.)
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
]

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
    ]
  },
  async rewrites() {
    return {
      // beforeFiles runs before the filesystem/app routes, so these take
      // precedence over anything under app/. This replicates the Cloudflare
      // Worker's query-string routing for the static storefront.
      beforeFiles: [
        // /?unsub=<email> -> unsubscribe handler (kept as a query so the
        // existing email links "…/?unsub=foo@bar.com" keep working).
        {
          source: "/",
          has: [{ type: "query", key: "unsub" }],
          destination: "/api/unsub",
        },
        // /?page=<facts|stories|admin|home>
        {
          source: "/",
          has: [{ type: "query", key: "page", value: "facts" }],
          destination: "/facts.html",
        },
        {
          source: "/",
          has: [{ type: "query", key: "page", value: "stories" }],
          destination: "/stories.html",
        },
        {
          source: "/",
          has: [{ type: "query", key: "page", value: "admin" }],
          destination: "/admin.html",
        },
        /* /admin, without the extension. The console has only ever answered
         * at /admin.html and /?page=admin, and the owner runs several sites:
         * every one of them should open its own console at the same address
         * rather than each needing its own remembered URL. The two above stay
         * working, because links to them exist. */
        { source: "/admin", destination: "/admin.html" },
        {
          source: "/",
          has: [{ type: "query", key: "page", value: "home" }],
          destination: "/index.html",
        },
        // Catch-all for "/" (also covers ?go=, ?focus=, ?add=, ?unsub handled above).
        {
          source: "/",
          destination: "/index.html",
        },
      ],
    }
  },
}

export default nextConfig
