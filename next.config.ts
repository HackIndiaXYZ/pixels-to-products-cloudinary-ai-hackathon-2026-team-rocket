import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Cloudinary delivery (media, fl_getinfo JSON, HEAD probes) and the Upload API (signed browser uploads). */
const CLOUDINARY_DELIVERY = "https://res.cloudinary.com";
const CLOUDINARY_API = "https://api.cloudinary.com";

/**
 * Content Security Policy. Everything VisualOps loads comes from its own origin or Cloudinary:
 *  - images, video posters and the WebGL texture atlas from res.cloudinary.com (img-src, media-src);
 *  - probes and fl_getinfo reads via fetch to res.cloudinary.com, uploads via XHR to api.cloudinary.com (connect-src);
 *  - fonts are self-hosted by next/font; report exports and previews use blob: URLs.
 * 'unsafe-inline' scripts are needed for Next's inline runtime/RSC payload on prerendered pages (no nonces:
 * pages stay static). 'unsafe-eval' and the dev-server websocket are allowed only in development.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${CLOUDINARY_DELIVERY}`,
  `media-src 'self' blob: ${CLOUDINARY_DELIVERY}`,
  `connect-src 'self' ${CLOUDINARY_DELIVERY} ${CLOUDINARY_API}${isDev ? " ws: wss:" : ""}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Browsers ignore HSTS on plain-http localhost; in production it pins the deployment to HTTPS.
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
