/**
 * Security headers applied to every route.
 * The screens' Content-Security-Policy carries a fresh script nonce per response,
 * so it is set in src/proxy.ts (policy text in src/server/csp.ts). The JSON routes
 * get a policy that lets nothing load.
 */
const API_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function securityHeaders() {
  const headers = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ];
  if ((process.env.HALQA_ORIGIN || '').startsWith('https:')) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
  }
  return headers;
}

/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders() },
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: API_POLICY }] },
    ];
  },
  webpack(config, { isServer }) {
    if (isServer) config.externals.push({ 'node:sqlite': 'commonjs node:sqlite' });
    return config;
  },
};
