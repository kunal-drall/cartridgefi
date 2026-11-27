/**
 * Mobile wallet deep links. On a plain mobile browser there is no injected Wallet Standard wallet, so we
 * offer to reopen the current page inside the wallet's in-app browser, where Wallet Standard works.
 */
export interface MobileWalletLink {
  name: string;
  href: string;
}

export function isMobileUserAgent(ua: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export function mobileWalletLinks(pageUrl: string): MobileWalletLink[] {
  const url = encodeURIComponent(pageUrl);
  const ref = encodeURIComponent(new URL(pageUrl).origin);
  return [
    { name: "Phantom", href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
    { name: "Solflare", href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
    { name: "Backpack", href: `https://backpack.app/ul/v1/browse/${url}?ref=${ref}` },
  ];
}
