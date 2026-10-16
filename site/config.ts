// Edit these before deploying the site.
export const SITE = {
  name: 'SwarmCorp',
  /** Public git URL for the install instructions. Empty = show a placeholder. */
  repoUrl: 'https://github.com/KunalSiyag/swarmcorp.git',
  /** One-time Pro licence price shown on the pricing section. A business decision: change freely. */
  proPrice: '$29',
  /** Dodo Payments product id (pdt_…) for the one-time Pro product, with licence keys enabled. Empty = "Checkout opens soon". */
  dodoProductId: 'pdt_0NprjAYH0j7Duj4p7vs6R',
  /** Public URL the site is served from, used for Dodo's redirect back to /thanks. */
  siteUrl: 'https://kunalsiyag.github.io/swarmcorp',
  /** Any other checkout link (Lemon Squeezy, Gumroad…), used only when dodoProductId is empty. */
  proCheckoutUrl: '',
  version: '0.4',
};

/** Dodo payment link. Dodo appends payment_id, status, email and license_key to redirect_url after payment. */
export function checkoutUrl(): string {
  if (SITE.dodoProductId) {
    const back = SITE.siteUrl ? `&redirect_url=${encodeURIComponent(SITE.siteUrl.replace(/\/$/, '') + '/thanks/')}` : '';
    return `https://checkout.dodopayments.com/buy/${encodeURIComponent(SITE.dodoProductId)}?quantity=1${back}`;
  }
  return SITE.proCheckoutUrl;
}
