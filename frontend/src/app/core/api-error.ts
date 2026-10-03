const FALLBACK = 'Something went wrong. Please try again.';
const UNREACHABLE = 'Cannot reach the server. Check your connection.';

/** Keys DRF uses for errors that belong to the whole request rather than one field. */
const WHOLE_REQUEST_KEYS = new Set(['detail', 'non_field_errors']);

function readableField(key: string): string {
  return key.replace(/_/g, ' ').trim();
}

/** A plain-text message, or null for markup such as a proxy's HTML error page. */
function plainText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) {
    return null;
  }
  return trimmed;
}

/** Finds the first message in a DRF error body, prefixed with its (innermost) field name. */
function firstMessage(value: unknown, field?: string): string | null {
  if (typeof value === 'string') {
    const text = plainText(value);
    if (text === null) {
      return null;
    }
    return field ? `${readableField(field)}: ${text}` : text;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstMessage(item, field);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const found = firstMessage(inner, WHOLE_REQUEST_KEYS.has(key) ? undefined : key);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/** Turns anything thrown by an HTTP call into one sentence the user can read. */
export function apiErrorMessage(err: unknown): string {
  if (err === null || typeof err !== 'object') {
    return FALLBACK;
  }
  const { status, error } = err as { status?: unknown; error?: unknown };
  if (status === 0) {
    return UNREACHABLE;
  }
  if (typeof status !== 'number') {
    return FALLBACK;
  }
  return firstMessage(error) ?? FALLBACK;
}
