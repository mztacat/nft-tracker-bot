const ETH_ADDR = /^0x[0-9a-fA-F]{40}$/;

export interface ParsedOpenSeaInput {
  kind: 'slug' | 'address';
  value: string;
}

/**
 * Normalises any user-supplied collection argument into a slug or address.
 *
 * Accepts:
 *   • Full URLs  https://opensea.io/collection/fuego-890436939/
 *   • Asset URLs https://opensea.io/assets/ethereum/0xABC…/123
 *   • Plain slugs  fuego
 *   • Plain addresses  0xABC…
 *
 * Returns null only when the input is clearly unparseable (empty string, etc.).
 */
export function parseOpenSeaInput(raw: string): ParsedOpenSeaInput | null {
  const arg = raw.trim().replace(/[.,;:!?]+$/, '');
  if (!arg) return null;

  // Already a bare address
  if (ETH_ADDR.test(arg)) return { kind: 'address', value: arg.toLowerCase() };

  // Try to parse as a URL
  let url: URL | null = null;
  try {
    url = new URL(arg.startsWith('http') ? arg : `https://${arg}`);
  } catch {
    // Not a URL — treat as slug
    return { kind: 'slug', value: arg.toLowerCase() };
  }

  const path = url.pathname.replace(/\/+$/, ''); // strip trailing slashes

  // https://opensea.io/assets/ethereum/0xABC.../123
  const assetMatch = path.match(/\/assets\/[^/]+\/(0x[0-9a-fA-F]{40})(?:\/\d+)?$/i);
  if (assetMatch) return { kind: 'address', value: assetMatch[1]!.toLowerCase() };

  // https://opensea.io/collection/<slug>
  const collectionMatch = path.match(/\/collection\/([^/]+)$/i);
  if (collectionMatch) return { kind: 'slug', value: collectionMatch[1]!.toLowerCase() };

  // Fallback: last path segment as slug
  const lastSegment = path.split('/').filter(Boolean).pop();
  if (lastSegment) return { kind: 'slug', value: lastSegment.toLowerCase() };

  return null;
}
