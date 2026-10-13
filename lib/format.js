// Fixed locale + UTC so server and browser render identical text (no hydration mismatch).
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtDay = (iso) => (iso ? dayFmt.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) : '');

// Server-only output (never hydrated), so the server's TZ is fine here.
export const fmtDateTime = (iso) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
