// ============================================================
// Sanitizace HTML pro dlouhý popis kurzu / workshopu (XSS ochrana)
// ============================================================

import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.2.5/+esm'

/** Povolené značky odpovídají toolbaru Quill (nadpisy, tučné, kurzíva, podtržení, odrážky). */
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'h2', 'h3'],
  ALLOWED_ATTR: [],
  ALLOW_DATA_ATTR: false,
}

export function sanitizeCourseRichText(dirty) {
  if (dirty == null) return ''
  const s = String(dirty)
  return DOMPurify.sanitize(s, RICH_TEXT_CONFIG)
}

/**
 * Quill ukládá nový řádek jako <p><br></p> — bez úpravy margin u <p> v detailu vzniká dvojnásobný odstup.
 * Sjednotí prázdné odstavce a ořízne zbytečné obalení před zobrazením (editor má line-height ~1.55, margin 0).
 */
export function normalizeCourseRichTextForDisplay(html) {
  let s = sanitizeCourseRichText(html).trim()
  if (!s) return ''
  s = s.replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, '<p><br></p>')
  s = s.replace(/<p>\s*<\/p>/gi, '<p><br></p>')
  return s
}
