import type { CollectionConfig, PayloadRequest } from 'payload';
import { convertLexicalToHTML, defaultHTMLConverters, UploadHTMLConverter } from '@payloadcms/richtext-lexical/html';
import { revalidateBlogFrontend } from '../utils/revalidateFrontend';

// Pixel caps matching the `displayWidth` options on the UploadFeature config
// in payload.config.ts — kept here instead of shared, since this is the only
// place either side of that config is actually consumed.
const DISPLAY_WIDTH_PX: Record<string, number> = { small: 400, medium: 700 };
// Left/right float a non-full image so text wraps around it, matching the
// classic blog-editor convention (WordPress's alignleft/alignright do the
// same thing) — a Full-width image ignores alignment since there's no room
// beside it. Float needs an explicit width to size correctly (unlike the
// centered case, which can just use max-width), so an aligned image with no
// displayWidth chosen still gets a sane default rather than floating at 100%.
const FLOAT_DEFAULT_PX = 320;

// The default UploadHTMLConverter always renders an inline image at its
// full original size, block-level — it has no concept of the
// `displayWidth`/`alignment` fields we added to the upload node (see
// payload.config.ts), so without this override, those per-image controls an
// editor picks in the admin UI would be saved but silently have zero effect
// on the published page.
const defaultUploadConverter = UploadHTMLConverter.upload as (args: { node: any; providedStyleTag: string }) => string;

const uploadConverterWithLayout = {
  upload: (args: { node: any; providedStyleTag: string }) => {
    const html = defaultUploadConverter(args);
    const fields = args.node.fields ?? {};
    const px = DISPLAY_WIDTH_PX[fields.displayWidth];
    const alignment = fields.alignment;

    if (alignment === 'left' || alignment === 'right') {
      const width = px ?? FLOAT_DEFAULT_PX;
      if (fields.wrapText === false) {
        // Positioned to one side, but not floated — no clearfix concerns,
        // and whatever comes next in the content just stacks below it
        // instead of wrapping alongside it. A block box already starts at
        // the left edge by default, so only Right needs an explicit push.
        const margin = alignment === 'left' ? '0 0 1rem 0' : '0 0 1rem auto';
        return `<div style="width:${width}px;margin:${margin};">${html}</div>`;
      }
      const floatMargin = alignment === 'left' ? '0 1.5rem 1rem 0' : '0 0 1rem 1.5rem';
      return `<div style="float:${alignment};width:${width}px;margin:${floatMargin};">${html}</div>`;
    }

    // Centered (explicit or default) — full width needs no wrapper at all.
    return px ? `<div style="max-width:${px}px;margin:0 auto;">${html}</div>` : html;
  },
};

const htmlConverters = { ...defaultHTMLConverters, ...uploadConverterWithLayout };

// The HTML converter trusts that any embedded upload node (an inline image
// dropped into the editor) is *already* populated in memory by the time
// this hook runs — if it isn't yet (a real timing/ordering issue with
// virtual-field hooks, not something under our control), its upload
// converter silently returns '' for that node instead of erroring, so the
// image just vanishes from contentHTML with no trace.
//
// The "correct" fix on paper is @payloadcms/richtext-lexical's async
// converter (convertLexicalToHTMLAsync + getPayloadPopulateFn), which
// resolves each upload node on demand instead of trusting ambient state —
// but calling it from inside this exact hook deadlocks: it shares Payload's
// per-request population-promise tracking, and this hook runs *as part of*
// the very population cycle that promise is waiting on. So instead we walk
// the tree ourselves and resolve any un-populated upload node with a plain,
// independent findByID (nothing shared with Payload's internal population
// machinery, so nothing to deadlock on), then hand the now-fully-resolved
// tree to the ordinary sync converter.
const resolveUploadNodes = async (node: any, req: PayloadRequest): Promise<void> => {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'upload' && node.relationTo && typeof node.value !== 'object') {
    node.value = await req.payload
      .findByID({ collection: node.relationTo, id: node.value, overrideAccess: true, depth: 0 })
      .catch(() => null);
  }
  const children = node.children;
  if (Array.isArray(children)) {
    await Promise.all(children.map((child) => resolveUploadNodes(child, req)));
  }
};

const toHTML = async (data: unknown, req: PayloadRequest) => {
  if (!data) return '';
  // Deep-clone first — mutating siblingData directly could interfere with
  // Payload's own in-flight population/serialization of the same field.
  const tree = JSON.parse(JSON.stringify(data));
  await resolveUploadNodes(tree.root, req);
  return convertLexicalToHTML({ data: tree, converters: htmlConverters });
};

const ROBOTS_OPTIONS = [
  { label: 'Index, Follow (default)', value: 'index,follow' },
  { label: 'Noindex, Follow', value: 'noindex,follow' },
  { label: 'Index, Nofollow', value: 'index,nofollow' },
  { label: 'Noindex, Nofollow', value: 'noindex,nofollow' },
];

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');

// Resolves the post's `author` relationship to a full user doc (avatar
// included, depth 1) via a privileged internal lookup, regardless of the
// requester's own read access to `users`. Payload doesn't cache across
// sibling virtual-field hooks within one request, so this refetches per
// field — acceptable here since it's a single indexed findByID, not a query.
const resolveAuthor = async (siblingData: any, req: any) => {
  const author = siblingData?.author;
  if (!author) return null;
  if (author && typeof author === 'object' && 'name' in author) return author;
  return req.payload
    .findByID({ collection: 'users', id: author, depth: 1, overrideAccess: true })
    .catch(() => null);
};

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Blog Post', plural: 'Blog Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', '_status', 'publishedAt'],
    group: 'Content',
  },
  access: {
    read: ({ req: { user } }) => {
      // Public (unauthenticated) requests only ever see published posts;
      // logged-in CMS users see everything, including drafts/scheduled.
      if (user) return true;
      return { _status: { equals: 'published' } };
    },
  },
  versions: {
    drafts: {
      autosave: { interval: 1000 },
      // Built-in Payload feature — this alone covers "Schedule Publishing":
      // an editor sets a future publish date and Payload flips the doc to
      // published automatically at that time (needs the scheduled-publish
      // job enabled in payload.config.ts).
      schedulePublish: true,
    },
    maxPerDoc: 20,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data && !data.slug && data.title) {
          data.slug = slugify(data.title);
        } else if (data?.slug) {
          data.slug = slugify(data.slug);
        }
        return data;
      },
    ],
    beforeChange: [
      ({ data }) => {
        // Reading Time (automatic) — derived from the lexical content's
        // approximate word count, ~200 wpm. Recomputed on every save so
        // editors never have to fill this in by hand.
        if (data?.content) {
          const text = JSON.stringify(data.content);
          const wordCount = text.split(/\s+/).filter(Boolean).length;
          data.readingTimeMinutes = Math.max(1, Math.round(wordCount / 200));
        }
        return data;
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, req }) => {
        // 301 Redirect on Slug Change (automatic) — if a published post's
        // slug changes, record the old -> new mapping in the `redirects`
        // collection so mj-digital-services's blog lookup can 301 old URLs
        // instead of 404ing them. Upserts (a slug can change more than
        // once, and `from` is unique) and never throws — redirect
        // bookkeeping must never block the actual publish.
        if (previousDoc?.slug && previousDoc.slug !== doc.slug) {
          try {
            const from = `/blog/${previousDoc.slug}`;
            const to = { url: `/blog/${doc.slug}` };
            const existing = await req.payload.find({
              collection: 'redirects',
              where: { from: { equals: from } },
              limit: 1,
            });
            if (existing.docs[0]) {
              await req.payload.update({ collection: 'redirects', id: existing.docs[0].id, data: { to } });
            } else {
              await req.payload.create({ collection: 'redirects', data: { from, to } });
            }
          } catch (err) {
            req.payload.logger.error(`Failed to record redirect for slug change: ${(err as Error).message}`);
          }
        }
      },
      async ({ doc, previousDoc }) => {
        // On-demand ISR revalidation on mj-digital-services — fires the
        // moment an editor saves instead of waiting up to 60s for the
        // fetch-level revalidate window. MUST be awaited, not fire-and-
        // forget: Vercel's serverless runtime can freeze/kill the function
        // the instant the response is sent, cutting off any un-awaited
        // outbound request before it completes. revalidateBlogFrontend()
        // itself never throws, so awaiting it still can't block/fail the save.
        await revalidateBlogFrontend(doc.slug);
        if (previousDoc?.slug && previousDoc.slug !== doc.slug) {
          await revalidateBlogFrontend(previousDoc.slug);
        }
        return doc;
      },
    ],
    afterDelete: [
      async ({ doc }) => {
        await revalidateBlogFrontend(doc.slug);
      },
    ],
  },
  fields: [
    // A `tabs` field as fields[0] is also what @payloadcms/plugin-seo looks
    // for (see payload.config.ts) — when it finds one, it appends its own
    // "SEO" tab onto this same array instead of injecting a second,
    // separate tabs field, so Write/Cover/SEO render as one unified tab bar
    // instead of stacking two tab groups on the page.
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Write',
          description: 'Craft the story readers will see on the blog.',
          fields: [
            // --- MANUAL: Basic content ---
            { name: 'title', type: 'text', required: true },
            {
              name: 'slug',
              type: 'text',
              required: true,
              unique: true,
              index: true,
              admin: { description: 'Auto-generated from the title. Edit to override (Slug Override).' },
            },
            { name: 'excerpt', type: 'textarea', required: true, maxLength: 500 },
            {
              name: 'content',
              type: 'richText',
              required: true,
            },
            {
              // Pre-rendered HTML so mj-digital-services never has to parse
              // Lexical JSON or depend on @payloadcms/richtext-lexical itself.
              name: 'contentHTML',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: { afterRead: [({ siblingData, req }) => toHTML(siblingData?.content, req)] },
            },
            {
              name: 'author',
              type: 'relationship',
              relationTo: 'users',
              required: true,
            },
            {
              // Users' own access rules correctly block public reads (staff emails/
              // roles shouldn't be exposed), which also blocks Payload from
              // populating `author` for unauthenticated requests. Rather than loosen
              // Users' security, denormalize the "Written by" display fields here via
              // a privileged internal lookup — the public API never touches
              // /api/users. One hook resolves the author doc once and every sibling
              // virtual field below reads off it, so a "Written by" post doesn't
              // need N separate lookups.
              name: 'authorName',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: { afterRead: [async ({ siblingData, req }) => (await resolveAuthor(siblingData, req))?.name] },
            },
            {
              name: 'authorJobTitle',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: { afterRead: [async ({ siblingData, req }) => (await resolveAuthor(siblingData, req))?.jobTitle] },
            },
            {
              name: 'authorBio',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: { afterRead: [async ({ siblingData, req }) => (await resolveAuthor(siblingData, req))?.bio] },
            },
            {
              name: 'authorLinkedinUrl',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: { afterRead: [async ({ siblingData, req }) => (await resolveAuthor(siblingData, req))?.linkedinUrl] },
            },
            {
              name: 'authorAvatarUrl',
              type: 'text',
              virtual: true,
              admin: { hidden: true },
              hooks: {
                afterRead: [
                  async ({ siblingData, req }) => {
                    const author = await resolveAuthor(siblingData, req);
                    const avatar = author?.avatar;
                    return avatar && typeof avatar === 'object' ? avatar.url : undefined;
                  },
                ],
              },
            },
            {
              name: 'category',
              type: 'relationship',
              relationTo: 'categories',
              required: true,
            },
            {
              name: 'tags',
              type: 'array',
              fields: [{ name: 'tag', type: 'text', required: true }],
            },

            // --- MANUAL: FAQ Content ---
            {
              name: 'faqsTitle',
              type: 'text',
              defaultValue: 'Frequently Asked Questions',
            },
            {
              name: 'faqs',
              type: 'array',
              fields: [
                { name: 'question', type: 'text', required: true },
                { name: 'answer', type: 'richText', required: true },
                {
                  name: 'answerHTML',
                  type: 'text',
                  virtual: true,
                  admin: { hidden: true },
                  hooks: { afterRead: [({ siblingData, req }) => toHTML(siblingData?.answer, req)] },
                },
              ],
            },

            // --- MANUAL: Internal Links ---
            {
              name: 'internalLinks',
              type: 'array',
              admin: { description: 'Hand-picked links to other posts/pages to surface in-content or in a sidebar block.' },
              fields: [
                { name: 'label', type: 'text', required: true },
                { name: 'url', type: 'text', required: true },
              ],
            },

            // --- MANUAL: Related Blogs (manual override; automatic fallback lives in mj-digital-services) ---
            {
              name: 'relatedPosts',
              type: 'relationship',
              relationTo: 'posts',
              hasMany: true,
              maxRows: 3,
              admin: { description: 'Leave empty to let the frontend auto-pick recent posts from the same category.' },
            },

            // --- MANUAL: Advanced SEO overrides not covered by the SEO plugin tab ---
            {
              type: 'collapsible',
              label: 'Advanced SEO',
              fields: [
                {
                  name: 'focusKeyword',
                  type: 'text',
                  admin: { description: 'Reference only for the editor — not rendered on the page.' },
                },
                {
                  name: 'canonicalUrlOverride',
                  type: 'text',
                  admin: { description: 'Leave empty to use the default https://www.mjdigitalservices.com/blog/<slug> canonical URL.' },
                },
                {
                  name: 'robots',
                  type: 'select',
                  defaultValue: 'index,follow',
                  options: ROBOTS_OPTIONS,
                },
                {
                  name: 'robotsNoarchive',
                  type: 'checkbox',
                  defaultValue: false,
                  label: 'Add noarchive',
                },
              ],
            },
          ],
        },
        {
          label: 'Cover',
          description: 'Images shown on the blog listing card and post hero.',
          fields: [
            {
              // Blog LISTING CARD image only (the grid on /blog) — deliberately not
              // reused for the hero banner or social share image below; an editor
              // may want a tighter/simpler shot for the small card thumbnail than
              // for a full-width hero. See `coverImage` for those.
              name: 'featuredImage',
              type: 'upload',
              relationTo: 'media',
              required: true,
              admin: {
                description:
                  'Shown on the blog listing page card only. Recommended ~800×500 (16:10) or ' +
                  'larger, subject centered — Payload crops this to the card\'s fixed aspect ratio, ' +
                  'so anything off-center gets cut. Alt text is set on the media asset itself once uploaded.',
              },
            },
            {
              // Full-width hero banner at the top of the post page, and the
              // og:image/Twitter-card/Article-schema image fallback when no SEO-tab
              // OG override is set — kept independent of `featuredImage` above so
              // an editor can pick a wider/differently-cropped shot for a
              // full-bleed hero than what works as a small card thumbnail. Optional:
              // falls back to `featuredImage` on mj-digital-services when left
              // empty, so existing posts (and anyone who skips this) keep working.
              name: 'coverImage',
              type: 'upload',
              relationTo: 'media',
              admin: {
                description:
                  'Optional — hero banner at the top of the post, and the social-share (OG) image. ' +
                  'Recommended ~1600×1000 (16:10) or larger, subject centered — this gets cropped ' +
                  'wider than the listing card, so a tight product/face shot can lose more here. ' +
                  'Leave empty to reuse the Featured Image above.',
              },
            },
          ],
        },
      ],
    },

    // --- AUTOMATIC (read-only, computed): Reading Time ---
    {
      name: 'readingTimeMinutes',
      type: 'number',
      admin: { readOnly: true, position: 'sidebar', description: 'Auto-calculated on save.' },
    },

    // --- MANUAL: Publish scheduling date; AUTOMATIC: Published/Modified Date ---
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
        description: 'Set a future date + use the "Schedule" publish action to schedule this post.',
      },
    },
    // `updatedAt` (Modified Date) and `createdAt` are added automatically by
    // Payload on every collection — no field needed here.
  ],
};

/*
 * AUTOMATIC items NOT represented as fields above, because they are computed
 * at request time by the consuming frontend (mj-digital-services) rather
 * than stored on the document — listed here so nobody re-implements them as
 * fields:
 *
 * - Breadcrumb / Breadcrumb Schema        -> rendered in mj-digital-services from the
 *                                            category + slug already on the doc.
 * - BlogPosting/Article Schema            -> JSON-LD built in mj-digital-services from
 *                                            title/excerpt/coverImage (falls back to
 *                                            featuredImage)/author/dates.
 * - FAQ Schema                            -> JSON-LD built from the `faqs` array above.
 * - Author Schema                         -> JSON-LD built from the `author` relationship.
 * - Canonical URL / OG Tags / Twitter Tags-> handled by @payloadcms/plugin-seo
 *   (see payload.config.ts) with `canonicalUrlOverride`/`robots` above as escape hatches.
 * - XML Sitemap / Sitemap Updates         -> generated by mj-digital-services's
 *   app/sitemap.ts, querying published posts via the Local API.
 * - 404 Monitoring / Broken Link Detection-> external tooling, not a CMS field.
 */
