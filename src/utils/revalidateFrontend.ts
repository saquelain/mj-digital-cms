// Mirrors mj-digital-backend's revalidation-secret contract — same secret,
// same endpoint, same best-effort contract. Fires an on-demand ISR
// revalidation on mj-digital-services after a post changes, instead of
// waiting up to 60s for the fetch-level revalidate window to expire.
export const revalidateBlogFrontend = async (slug?: string) => {
  const baseUrl = process.env.FRONTEND_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!baseUrl || !secret) return;

  try {
    await fetch(`${baseUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ slug }),
    });
  } catch (err) {
    console.error('[revalidateFrontend] failed to revalidate blog frontend:', (err as Error).message);
  }
};
