/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  distDir: "out",
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  assetPrefix: './',
  webpack: (config, { isServer }) => {
    // Only include serialport in Node.js environment
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        child_process: false,
        net: false,
        tls: false,
        stream: false,
        crypto: false,
        constants: false,
        util: false,
        assert: false,
        http: false,
        https: false,
        zlib: false,
        events: false,
      }
    }
    return config
  },
}

module.exports = nextConfig
