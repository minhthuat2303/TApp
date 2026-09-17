// T_SHOP Mobile - Deterministic Vietnamese Diacritic & Search Normalization Engine
// Guarantees zero-accent search parity with accented Vietnamese text.

/**
 * Strips all Vietnamese combining and decomposed diacritics into base Latin characters.
 * Deterministic conversion table:
 * á à ả ã ạ ă ắ ằ ẳ ẵ ặ â ấ ầ ẩ ẫ ậ -> a
 * é è ẻ ẽ ẹ ê ế ề ể ễ ệ -> e
 * í ì ỉ ĩ ị -> i
 * ó ò ỏ õ ọ ô ố ồ ổ ỗ ộ ơ ớ ờ ở ỡ ợ -> o
 * ú ù ủ ũ ụ ư ứ ừ ử ữ ự -> u
 * ý ỳ ỷ ỹ ỵ -> y
 * đ -> d, Đ -> D
 */
export function removeVietnameseDiacritics(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[\u02C6\u0306\u031B]/g, '');
}

/**
 * Normalizes user search input or searchable text:
 * - Trims leading & trailing spaces
 * - Lowercases
 * - Strips Vietnamese accents
 * - Compresses multiple continuous spaces into single space
 */
export function normalizeSearchString(text: string): string {
  if (!text) return '';
  return removeVietnameseDiacritics(text)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Checks if a target string matches a query string using Vietnamese normalization.
 * Supports:
 * - Exact match
 * - Prefix match
 * - Substring contains match
 * - Multi-keyword token match (every word in query must appear in target)
 */
export function matchesVietnameseSearch(target: string, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!target) return false;

  const normalizedQuery = normalizeSearchString(query);
  if (!normalizedQuery) return true;

  const normalizedTarget = normalizeSearchString(target);

  // 1. Exact match
  if (normalizedTarget === normalizedQuery) return true;

  // 2. Substring contains / prefix
  if (normalizedTarget.includes(normalizedQuery)) return true;

  // 3. Multi-keyword token match: "bup be" -> ["bup", "be"] -> both in "bup be barbie"
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  if (tokens.length > 1) {
    const allTokensMatch = tokens.every(token => normalizedTarget.includes(token));
    if (allTokensMatch) return true;
  }

  // 4. Raw target match without normalization (fallback)
  const rawLowerTarget = target.toLowerCase();
  const rawLowerQuery = query.toLowerCase().trim();
  if (rawLowerTarget.includes(rawLowerQuery)) return true;

  return false;
}

/**
 * Match score for ordering search results:
 * 100: Exact barcode/SKU
 * 90: Exact name
 * 80: Name starts with query
 * 70: Name contains query
 * 60: Multi-token match
 * 0: No match
 */
export function calculateSearchRank(name: string, sku: string, query: string, barcode?: string): number {
  const normQuery = normalizeSearchString(query);
  if (!normQuery) return 1;

  const normName = normalizeSearchString(name);
  const normSku = normalizeSearchString(sku);
  const normBarcode = barcode ? normalizeSearchString(barcode) : '';

  if (normSku === normQuery || (normBarcode && normBarcode === normQuery)) return 100;
  if (normName === normQuery) return 90;
  if (normName.startsWith(normQuery) || normSku.startsWith(normQuery)) return 80;
  if (normName.includes(normQuery) || normSku.includes(normQuery)) return 70;

  const tokens = normQuery.split(' ').filter(Boolean);
  if (tokens.length > 1 && tokens.every(t => normName.includes(t))) return 60;

  return 0;
}
