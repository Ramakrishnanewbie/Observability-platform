/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",   // required for Docker production build
};

module.exports = nextConfig;
