/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The landing page (/) is dynamic and reads docs/onboarding.md at runtime;
  // ensure the file is shipped to the serverless function. (/docs is static.)
  outputFileTracingIncludes: {
    '/': ['./docs/onboarding.md'],
    '/docs': ['./docs/onboarding.md'],
  },
}

export default nextConfig
