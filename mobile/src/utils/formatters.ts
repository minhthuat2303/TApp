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
