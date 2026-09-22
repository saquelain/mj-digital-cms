import { withPayload } from '@payloadcms/next/withPayload';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // sharp is a native binary — without this, Next's bundler can break its
  // platform-specific binary at build time, which silently disables
  // Payload's image resizing (thumbnail/card/og sizes) in production.
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [
      // R2 bucket used for media uploads — matches the pattern already used
      // by mj-digital-backend for blog image uploads.
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
