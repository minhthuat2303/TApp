// Mobile Currency & Number Formatters matching Web Standards

export function formatCurrency(num: number | string | null | undefined, suffix: string = ' đ'): string {
  const val = Number(num) || 0;
  // Intl format thousands with comma
  const formatted = Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return suffix ? `${formatted}${suffix}` : formatted;
}

export function formatNumber(num: number | string | null | undefined): string {
  const val = Number(num) || 0;
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatInteger(num: number | string | null | undefined): string {
  return formatNumber(num);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [year, month, day] = s.split('-');
      return `${day}/${month}/${year}`;
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${day}/${month}/${year}`;
  } catch {
    return String(dateStr);
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [year, month, day] = s.split('-');
      return `${day}/${month}/${year}`;
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} ${day}/${month}/${year}`;
  } catch {
    return String(dateStr);
  }
}

/**
 * Formats a raw number or input string as a comma-separated currency string (e.g. 125000 -> "125,000", "125000.00" -> "125,000")
 * Handles node-postgres decimal strings like '125000.00' without appending extra zeros.
 */
export function formatCurrencyInput(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'number' ? Math.round(val) : Math.round(parseFloat(String(val).replace(/,/g, '')) || 0);
  if (isNaN(num)) return '';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Parses a currency input string (e.g. "125,000" or "125000" or "125000.00") into an integer VND number (e.g. 125000).
 * Protects against accidental multiplication or trailing decimal issues.
 */
export function parseCurrencyInput(str: string | number | null | undefined): number {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return Math.round(str);
  const cleaned = String(str).replace(/,/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}
