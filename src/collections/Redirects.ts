import type { CollectionConfig } from 'payload';

// Populated automatically by Posts' afterChange hook when a published slug
// changes. mj-digital-services reads this collection to serve 301s for old URLs.
export const Redirects: CollectionConfig = {
  slug: 'redirects',
  access: { read: () => true },
  admin: { useAsTitle: 'from', group: 'Settings' },
  fields: [
    { name: 'from', type: 'text', required: true, unique: true, index: true },
    {
      name: 'to',
      type: 'group',
      fields: [{ name: 'url', type: 'text', required: true }],
    },
  ],
};
