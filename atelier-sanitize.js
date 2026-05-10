// ============================================================
// Sanitizace HTML pro dlouhý popis kurzu / workshopu (XSS ochrana)
// ============================================================

import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.2.5/+esm'

/** Povolené značky odpovídají toolbaru Quill (tučné, kurzíva, podtržení, odrážky). */
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
}

export function sanitizeCourseRichText(dirty) {
  if (dirty == null) return ''
  const s = String(dirty)
  return DOMPurify.sanitize(s, RICH_TEXT_CONFIG)
}
