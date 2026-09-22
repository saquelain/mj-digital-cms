import type { CollectionConfig } from 'payload';

// Payload's own auth-enabled collection for CMS editors — intentionally
// separate from mj-digital-backend's User model (JWT/bcrypt, admin site).
// Do not attempt to merge these; see CLAUDE.md "Auth" section.
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: 'Content',
  },
  access: {
    // Only logged-in CMS users can view the user list; nobody can self-register.
    read: ({ req: { user } }) => Boolean(user),
    create: ({ req: { user } }) => user?.role === 'admin',
    update: ({ req: { user } }) => user?.role === 'admin',
    delete: ({ req: { user } }) => user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
    },
    {
      type: 'collapsible',
      label: 'Blog Author Profile',
      admin: {
        description:
          'Shown on the public "Written by" section of any post this user is set as author on — filled in once per person, not per post.',
      },
      fields: [
        {
          name: 'jobTitle',
          type: 'text',
          admin: { description: 'e.g. "Content Strategist at MJ Digital Services"' },
        },
        {
          name: 'bio',
          type: 'textarea',
        },
        {
          name: 'linkedinUrl',
          type: 'text',
          admin: { description: 'Full profile URL, e.g. https://linkedin.com/in/...' },
        },
        {
          name: 'avatar',
          type: 'upload',
          relationTo: 'media',
        },
      ],
    },
  ],
};
