const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return date.toISOString().slice(0, 10) === value ? date : null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseRangeStart(value: string | null): Date | null {
  return parseDate(value);
}

/** Date-only end values include the entire selected UTC calendar day. */
export function parseRangeEnd(value: string | null): Date | null {
  const date = parseDate(value);
  if (!date) return null;
  if (value && DATE_ONLY.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
}
