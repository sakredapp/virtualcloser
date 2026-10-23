// Used ONLY by selfhost/app.Dockerfile (copied in as next.config.mjs inside the
// image). The Vercel build has no next.config and is unchanged by this file.
// `standalone` makes .next/standalone/server.js: a plain Node server with only
// the files it needs, so the box runs `node server.js` and no Vercel.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // CI on GitHub runs the typecheck and lint; the image build skips them to
  // keep the build inside the box's memory budget.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // lib/emailSmtp.ts loads nodemailer at runtime (webpackIgnore), so make sure
  // the standalone output ships it.
  outputFileTracingIncludes: { '/**': ['./node_modules/nodemailer/**'] },
}
export default nextConfig
