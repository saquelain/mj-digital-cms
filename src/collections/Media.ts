import type { CollectionConfig } from 'payload';
import { APIError } from 'payload';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

// Covers: Featured Image, Image Alt Text, Image Compression, WebP/AVIF,
// Responsive Images (via Payload's imageSizes + Sharp, generated automatically
// on upload — no manual admin work needed for the resize/format part).
export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Media', plural: 'Media Library' },
  admin: { group: 'Content' },
  access: {
    read: () => true, // public site needs to fetch images without auth
  },
  hooks: {
    // There's no per-collection file-size option on Payload's UploadConfig
    // (confirmed against its type defs) — this is the documented way to
    // enforce one. Runs before the file is handed to the S3/R2 adapter, for
    // both `create` (new upload) and `update` (replacing an existing Media
    // doc's file), so an oversized file never reaches storage. Covers every
    // upload path that goes through this collection — the admin panel's own
    // upload UI, the Lexical editor's inline image feature, and the REST
    // API directly — since they all funnel through this same create/update
    // operation, not just one of them.
    beforeOperation: [
      ({ req, operation }) => {
        if ((operation === 'create' || operation === 'update') && req.file && req.file.size > MAX_UPLOAD_BYTES) {
          throw new APIError(
            `Image is too large (${(req.file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is 2MB.`,
            400,
          );
        }
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description: 'Required — used as the <img alt> tag for accessibility and image SEO.',
      },
    },
  ],
  upload: {
    // Lets an editor drag a crosshair over the uploaded image (in its admin
    // detail view) marking the actual subject. Whenever a crop's aspect
    // ratio doesn't match the source image's own aspect ratio, Payload
    // centers the crop on that point instead of the image's literal center.
    // Without this, `position: 'centre'` below is taken completely
    // literally: an off-center subject gets cropped away on the tighter
    // sizes (card, thumbnail) no matter how the source was composed.
    focalPoint: true,
    // Each size needs its OWN `formatOptions` — the top-level one below
    // only converts the original/base image; Payload does not fall back to
    // it per size (confirmed against Payload's own resize source), so
    // without repeating it here, thumbnail/card/og would be silently
    // generated in the source's original format (jpeg/png), never webp.
    //
    // `position: 'centre'` below is now effectively just the fallback for
    // an upload with no focal point set (Payload defaults focalX/focalY to
    // 50/50, i.e. dead-center, until an editor moves it) — focalPoint above
    // is what actually drives the crop once one is set.
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      { name: 'card', width: 768, height: 480, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      { name: 'og', width: 1200, height: 630, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      // Full-width banner at the top of a blog post — wider than
      // `card`/`og` need, since it's rendered much larger on screen.
      { name: 'hero', width: 1600, height: 1000, position: 'centre', formatOptions: { format: 'webp', options: { quality: 80 } } },
      // AVIF siblings of `card` and `hero` — the two sizes the frontend
      // actually swaps into a <picture> element (the blog listing grid, and
      // every post's own hero banner — its highest-visibility image, seen
      // by every reader). Not duplicating thumbnail/og as AVIF too: og:image
      // is read by social-media crawlers that often mishandle even WebP, so
      // it deliberately stays on the plain webp/original fallback chain;
      // thumbnail is a small sidebar-only image where the extra storage
      // isn't worth it.
      { name: 'cardAvif', width: 768, height: 480, position: 'centre', formatOptions: { format: 'avif' } },
      { name: 'heroAvif', width: 1600, height: 1000, position: 'centre', formatOptions: { format: 'avif' } },
    ],
    adminThumbnail: 'thumbnail',
    formatOptions: { format: 'webp', options: { quality: 80 } },
    // `image/avif` is here for the generated `cardAvif` size's own output,
    // not for uploads — Payload validates every generated image size's
    // resulting MIME type against this same allowlist, so without it any
    // upload that's large enough to actually produce a cardAvif size fails
    // validation on that size and the whole upload is rejected.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  },
};
