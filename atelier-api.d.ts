// ============================================================
// atelier-api.d.ts — SSOT typový kontrakt mezi vanilla a Svelte vrstvou.
// Žádný runtime kód. Rozšiřovat pouze tehdy, když má nový typ /
// nová metoda konkrétního konzumenta.
// ============================================================

export type Locale = 'cs' | 'en'

export interface LocalizedText {
  cs?: string
  en?: string
}

export interface Course {
  id: string | number
  title: LocalizedText
  color_code?: string
  is_workshop?: boolean
}

export interface Lesson {
  lesson_id: string | number
  course_id: string | number
  start_time: string
  end_time: string
  capacity: number
  booked_count: number
  available_spots: number
  status?: string
}

// Plná taxonomie 6 eventů — fixní strop dohodnutý v architektuře.
// Day 1 emituje jen LANG_CHANGED / COURSES_UPDATED / LESSONS_UPDATED.
export type AtelierEventName =
  | 'atelier:lang-changed'
  | 'atelier:courses-updated'
  | 'atelier:lessons-updated'
  | 'atelier:bookings-updated'
  | 'atelier:auth-changed'
  | 'atelier:ui-updated'

export interface AtelierEventsAPI {
  readonly LANG_CHANGED:     'atelier:lang-changed'
  readonly COURSES_UPDATED:  'atelier:courses-updated'
  readonly LESSONS_UPDATED:  'atelier:lessons-updated'
  readonly BOOKINGS_UPDATED: 'atelier:bookings-updated'
  readonly AUTH_CHANGED:     'atelier:auth-changed'
  readonly UI_UPDATED:       'atelier:ui-updated'
  on(name: AtelierEventName, handler: (e: CustomEvent) => void): () => void
  emit(name: AtelierEventName, detail?: unknown): void
}

// Day 1 jen jediná akce, kterou Calendar volá. Další se přidávají při migraci dalších islandů.
export interface AtelierActions {
  openBookingPopup(
    courseId: string | number,
    passId?: string | null,
    lessonId?: string | number | null,
    preferredPay?: string | null
  ): void
}

// Day 1 jen čtení toho, co Calendar potřebuje.
export interface AtelierState {
  getCourses(): readonly Course[]
  getUpcomingLessons(): readonly Lesson[]
  getLang(): Locale
}

export interface AtelierI18n {
  t(path: string, params?: Record<string, string | number>): string
  getLang(): Locale
}

export interface AtelierAPI {
  readonly version: string
  readonly actions: Readonly<AtelierActions>
  readonly state: Readonly<AtelierState>
  readonly events: AtelierEventsAPI
  readonly i18n: Readonly<AtelierI18n>
}

declare global {
  interface Window {
    AtelierAPI: AtelierAPI
    AtelierSvelte?: {
      mount(name: string, target: Element, props?: Record<string, unknown>): unknown
      unmount(target: Element): void
    }
    AppState?: {
      courses?: Course[]
      lessons?: Lesson[]
      upcomingLessons?: Lesson[]
      weekStart?: Date
      initialized?: boolean
      [key: string]: unknown
    }
    __uiLang?: Locale
    __userRole?: 'uzivatel' | 'lektor' | 'admin'
    __appNavHooks?: Array<(id: string, el?: HTMLElement) => void>
    __features?: { svelteCalendar?: boolean; [key: string]: boolean | undefined }
    openBookingPopup?: (
      courseId: string | number,
      passId?: string | null,
      lessonId?: string | number | null,
      preferredPay?: string | null
    ) => void
  }
}

export {}
