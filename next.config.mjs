/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      fs: false,
      net: false,
      tls: false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
