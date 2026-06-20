/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Type errors fail the build. The codebase is type-clean (verified with
    // `tsc --noEmit`); we deliberately do NOT suppress build-time type checking.
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
