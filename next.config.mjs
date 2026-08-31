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
        // A CLEAN URL FOR THE ONE PAGE THAT GETS READ ALOUD. /makers.html is
        // the file and stays reachable; this is the address that has to survive
        // a phone call to a shop owner, an Instagram DM and a business card,
        // where ".html" is four extra syllables and something for the listener
        // to get wrong. A rewrite rather than a redirect, so both spellings
        // serve the page and no link already sent to a maker ever breaks.
        //
        // Deliberately not `cleanUrls: true`, which would do this site-wide and
        // 308 every existing .html address to a new one: the nav links carry
        // ?v=2 cache-busters, sitemap.xml names the .html paths, and the
        // service worker has its own opinions about what it cached. One page
        // needs this; the other eight do not.
        {
          source: "/makers",
          destination: "/makers.html",
        },
        {
          /* Same reasoning as /makers: these are addresses somebody says out
             loud in a shop doorway, and ".html" is four extra syllables and
             one more thing for the listener to get wrong. Rewrites rather than
             redirects, so both spellings keep working. */
          source: "/local",
          destination: "/local.html",
        },
        {
          source: "/list",
          destination: "/list.html",
        },
        {
          /* The one a shop actually scans. It carries ?t= and a rewrite passes
             the query through untouched, which a redirect would also do but
             with a round trip nobody standing at a counter should pay for. */
          source: "/redeem",
          destination: "/redeem.html",
        },
      ],
    }
  },
}

export default nextConfig
