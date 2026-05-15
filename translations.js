// ============================================================
// translations.js — statické texty UI (mimo DB: kurzy/permanentky)
// Klíče: anglická tečková notace, např. t('cs', 'booking.section.session')
// Placeholdery: {{param}}  →  t('en', 'booking.example', { n: 3 })
// EN řetězce — britská angličtina (UK)
// ============================================================

/** localStorage klíč synchronizovaný s atelier-data.js */
export const UI_LANG_STORAGE_KEY = 'atelier.uiLang'

/** @type {Record<'cs' | 'en', Record<string, unknown>>} */
export const UI_TRANSLATIONS = {
  cs: {
    common: {
      close: 'Zavřít',
      cancel: 'Zrušit',
      confirm: 'Potvrdit',
      save: 'Uložit změny',
      loading: 'Načítám…',
      back: 'Zpět',
      spots: 'míst',
      enrolled: 'PŘIHLÁŠENO',
      full: 'Plno',
      lessonFallback: 'Lekce',
      price: 'Cena',
      course: 'Kurz',
      pass: 'Permanentka',
      session: 'Termín',
      programme: 'Program',
    },
    lang: {
      switchToEnglish: 'English',
      switchToCzech: 'Česky',
      ariaChangeLanguage: 'Změnit jazyk',
      ariaSwitchToEnglish: 'Přepnout na angličtinu',
      ariaSwitchToCzech: 'Přepnout do češtiny',
    },
    nav: {
      overview: 'Přehled',
      calendar: 'Kalendář',
      courses: 'Kurzy',
      passes: 'Permanentky',
      myLessons: 'Moje lekce',
      settings: 'Nastavení',
      customers: 'Zákazníci',
      payments: 'Platby',
      sectionOverview: 'PŘEHLED',
      sectionManagement: 'SPRÁVA',
    },
    pages: {
      signIn: 'Přihlásit se',
      avatarGuestTitle: 'Přihlásit se',
      settingsTitle: 'Nastavení',
      settingsSub: 'Správa účtu',
      personalData: 'Osobní údaje',
      fullName: 'Jméno a příjmení',
      fullNamePh: 'Vaše jméno',
      email: 'E-mailová adresa',
      emailPh: 'email@domena.cz',
      avatarColour: 'Barva avatara',
      avatarColourHint:
        'Vyberte barvu kolečka, která se zobrazí v horní liště u vašeho profilu.',
      changePassword: 'Změna hesla',
      passwordHelper:
        'Nastavte nebo změňte heslo pro přihlášení e-mailem a heslem. Pokud to bude Supabase vyžadovat, vyplňte i současné heslo. Heslo se uloží spolu s tlačítkem „Uložit změny“ níže.',
      currentPassword: 'Současné heslo',
      currentPasswordPh: 'Vaše aktuální heslo',
      newPassword: 'Nové heslo',
      newPasswordPh: 'Minimálně 8 znaků',
      confirmPassword: 'Potvrzení hesla',
      confirmPasswordPh: 'Zopakujte nové heslo',
      notifications: 'Notifikace',
      lessonReminder: 'Připomínka lekce',
      reminder6h: '6 hodin předem',
      reminder24h: '24 hodin předem',
      reminder48h: '48 hodin předem',
      reminderOff: 'Nezasílat',
      dangerZone: 'Nebezpečná zóna',
      deleteAccountTitle: 'Smazání účtu',
      deleteAccountLead:
        'Trvalé smazání účtu. Aktivní permanentky zanikají bez nároku na automatickou refundaci.',
      deleteAccountBtn: 'Smazat můj účet',
      popKalClose: 'Zavřít',
      popBookingCancel: 'Zrušit',
      signOut: 'Odhlásit se',
    },
    booking: {
      section: {
        session: 'Termín',
        payment: 'Způsob platby',
      },
      btn: {
        confirmBooking: 'Potvrdit rezervaci',
        confirmAndPay: 'Potvrdit a zaplatit {{price}}',
        /** {{slot}}, {{price}} — fmtPrice */
        buyPassAndBook: 'Koupit a zarezervovat termín · {{slot}} · {{price}}',
        cancel: 'Zrušit',
        buyPass: 'Koupit permanentku',
        continueToBooking: 'Pokračovat k rezervaci',
        booking: 'Rezervuji…',
        buying: 'Kupuji…',
        book: 'Rezervovat',
        bookSelected: 'Rezervovat vybrané ({{n}})',
      },
      slot: {
        selectPrompt: '— vyberte termín —',
      },
      payment: {
        singleSession: 'Jednorázový vstup',
        /** Popisek pod jednorázovou platbou v modalu */
        singleSessionValidity: 'Platí pro jednu lekci',
        entriesLeft: '{{n}} vstupů zbývá',
        entriesLabel: 'vstupů',
        perEntry: 'vstup',
        passAvailableToBuy: 'Permanentka ke koupi',
      },
      option: {
        enrolled: 'Přihlášeno',
        full: 'Plno',
        spotsSuffix: '{{n}} míst',
      },
      empty: {
        noScheduledSessions: 'Žádné vypsané termíny.',
        noSlotsToBook: 'Momentálně žádné volné termíny',
        noFreeSlotsOption: 'Žádné volné termíny k rezervaci',
        selectedLessonPlaceholder: 'Vybraná lekce',
      },
      multiHint:
        'Můžeš vybrat nejvýše {{max}} {{sessionsWord}} (tolik zbývá na permanentce).',
      multiHintSessionsOne: 'termín',
      multiHintSessionsFew: 'termíny',
      multiHintSessionsMany: 'termínů',
      passPickerCountSelected: 'Vybráno {{n}} z {{cap}} vstupů',
      toast: {
        selectSession: 'Vyberte prosím termín.',
        selectAtLeastOne: 'Vyberte alespoň jeden termín.',
        selectValidPass: 'Vyberte platnou permanentku.',
        singleUnavailableWithPass:
          'Pokud máte aktivní permanentku pro tento kurz, jednorázový vstup není k dispozici.',
        sessionNoLongerAvailable: 'Některý termín už není k dispozici.',
        passNotForCourse: 'Permanentka neplatí pro tento kurz.',
        passEntriesLimitReached:
          'Dosáhli jste limitu své permanentky. Pro další lekce si prosím zakupte novou.',
        cancelNoLesson: 'Nelze zrušit rezervaci (chybí lekce).',
        noActiveBooking: 'Aktivní rezervace nenalezena.',
        cancelled: 'Rezervace byla zrušena.',
        errorPrefix: 'Chyba: ',
        singleCannotCancel: 'Jednorázový vstup nelze stornovat.',
      },
      success: {
        one: '✓ Lekce rezervována!',
        many: '✓ Rezervováno {{n}} lekcí.',
      },
      selectedCount: '{{n}} vybraných termínů',
    },
    kal: {
      duration: 'Délka',
      spots: 'Volná místa',
      cancelBooking: 'Stornovat rezervaci',
    },
    catalog: {
      validAllCourses: 'Platí na všechny kurzy',
      selectedCoursesDetail: 'Vybrané kurzy (viz detail)',
    },
    courses: {
      noActiveCourses: 'Žádné aktivní kurzy',
      badgeFull: 'plno',
      badgeSpots: 'volná místa',
      detailLink: 'Detail kurzu →',
      lessonListTitle: 'Vypsané termíny',
      photoAlt: 'foto kurzu',
      noDates: 'Žádné termíny',
      optionFullSuffix: 'plno',
      backToCourses: 'Zpět na kurzy',
      capacitySpots: 'míst',
      spotsFree: 'volných',
      perSession: 'vstup',
      gallery: 'Galerie',
      enlargePhoto: 'Zvětšit fotografii',
      instructor: 'Lektor/ka',
      scheduleLabel: 'Termíny',
      freeCancellation: 'Storno zdarma',
      ahead: 'předem',
      scheduledDates: 'Vypsané termíny',
      allSessionsFull: 'Lekce je plně obsazena.',
      noScheduledSessionsShort: 'Žádné vypsané termíny.',
      galleryPrev: 'Předchozí fotografie',
      galleryNext: 'Další fotografie',
    },
    payment: {
      externalTitle: 'Způsob platby',
      externalLead:
        'Platba proběhne pouze na zabezpečených stránkách Stripe (mimo tuto aplikaci). Aplikace nezpracovává kartové údaje ani platby.',
      externalMissingUrl:
        'Pro tuto položku není nastaven odkaz Stripe. V index.html doplňte window.__externalStripePayments (passDefault / singleLessonDefault / byPassId / byCourseId).',
      payStripe: 'Zaplatit přes Stripe',
      stripeMissingToast: 'Chybí odkaz na Stripe.',
      stripeOpenedToast:
        'Otevřeli jsme Stripe v nové záložce. Rezervaci nebo permanentku zaktivníme po přijetí platby.',
      summaryPass: 'Permanentka',
      summaryPrice: 'Cena',
      summarySessionAfterPay: 'Zvolený termín (rezervaci dokončíme po zaplacení)',
      summaryCourse: 'Kurz',
      summarySession: 'Termín',
      validUntil: 'Platí do {{date}}',
    },
    purchase: {
      confirmComplete: 'Přejete si tento nákup skutečně uskutečnit?',
      duplicatePass:
        'Už máte aktivní permanentku stejného typu. Opravdu chcete koupit znovu? (může jít o duplicitní nákup.)',
      passPurchased: '✓ Permanentka zakoupena.',
      passPurchaseErrorPrefix: 'Chyba při nákupu: ',
    },
    shop: {
      signInPrompt: 'Přihlaste se.',
      loading: 'Načítám…',
      emptyCatalog: 'Žádné permanentky momentálně nejsou v nabídce.',
      fetchError: 'Nepodařilo se načíst permanentky.',
      validityOneWeek: 'Platnost po zakoupení: 1 týden',
      validityWeeksFew: 'Platnost po zakoupení: {{weeks}} týdny',
      validityWeeksMany: 'Platnost po zakoupení: {{weeks}} týdnů',
    },
  },

  en: {
    common: {
      close: 'Close',
      cancel: 'Cancel',
      confirm: 'Confirm',
      save: 'Save changes',
      loading: 'Loading…',
      back: 'Back',
      spots: 'spaces',
      enrolled: 'ENROLLED',
      full: 'Full',
      lessonFallback: 'Session',
      price: 'Price',
      course: 'Course',
      pass: 'Pass',
      session: 'Session',
      programme: 'Programme',
    },
    lang: {
      switchToEnglish: 'English',
      switchToCzech: 'Česky',
      ariaChangeLanguage: 'Change language',
      ariaSwitchToEnglish: 'Switch to English',
      ariaSwitchToCzech: 'Switch to Czech',
    },
    nav: {
      overview: 'Overview',
      calendar: 'Calendar',
      courses: 'Courses',
      passes: 'Passes',
      myLessons: 'My lessons',
      settings: 'Settings',
      customers: 'Customers',
      payments: 'Payments',
      sectionOverview: 'OVERVIEW',
      sectionManagement: 'MANAGEMENT',
    },
    pages: {
      signIn: 'Sign in',
      avatarGuestTitle: 'Sign in',
      settingsTitle: 'Settings',
      settingsSub: 'Account',
      personalData: 'Personal details',
      fullName: 'Full name',
      fullNamePh: 'Your name',
      email: 'Email address',
      emailPh: 'you@example.com',
      avatarColour: 'Avatar colour',
      avatarColourHint:
        'Choose the circle colour shown next to your profile in the top bar.',
      changePassword: 'Change password',
      passwordHelper:
        'Set or change the password you use to sign in with email. If Supabase requires it, include your current password as well. It is saved when you press “Save changes” below.',
      currentPassword: 'Current password',
      currentPasswordPh: 'Your current password',
      newPassword: 'New password',
      newPasswordPh: 'At least 8 characters',
      confirmPassword: 'Confirm password',
      confirmPasswordPh: 'Repeat your new password',
      notifications: 'Notifications',
      lessonReminder: 'Lesson reminder',
      reminder6h: '6 hours before',
      reminder24h: '24 hours before',
      reminder48h: '48 hours before',
      reminderOff: 'Don’t send',
      dangerZone: 'Danger zone',
      deleteAccountTitle: 'Delete account',
      deleteAccountLead:
        'Permanently delete your account. Active passes lapse with no automatic refund.',
      deleteAccountBtn: 'Delete my account',
      popKalClose: 'Close',
      popBookingCancel: 'Cancel',
      signOut: 'Sign out',
    },
    booking: {
      section: {
        session: 'Session',
        payment: 'Payment method',
      },
      btn: {
        confirmBooking: 'Confirm booking',
        confirmAndPay: 'Confirm and pay {{price}}',
        buyPassAndBook: 'Buy a pass & book for {{slot}} · {{price}}',
        cancel: 'Cancel',
        buyPass: 'Buy a pass',
        continueToBooking: 'Continue to booking',
        booking: 'Booking…',
        buying: 'Buying…',
        book: 'Book',
        bookSelected: 'Book selected ({{n}})',
      },
      slot: {
        selectPrompt: '— select a session —',
      },
      payment: {
        singleSession: 'Single session',
        singleSessionValidity: 'Valid for one session',
        entriesLeft: '{{n}} entries left',
        entriesLabel: 'entries',
        perEntry: 'entry',
        passAvailableToBuy: 'Pass available to buy',
      },
      option: {
        enrolled: 'Booked',
        full: 'Full',
        spotsSuffix: '{{n}} spaces',
      },
      empty: {
        noScheduledSessions: 'No sessions scheduled yet.',
        noSlotsToBook: 'No open sessions right now',
        noFreeSlotsOption: 'No sessions available to book',
        selectedLessonPlaceholder: 'Selected session',
      },
      multiHint:
        'You can pick up to {{max}} {{sessionsWord}} — that’s what’s left on your pass.',
      multiHintSessionsOne: 'session',
      multiHintSessionsFew: 'sessions',
      multiHintSessionsMany: 'sessions',
      passPickerCountSelected: 'Selected {{n}} of {{cap}} {{entriesWord}}',
      toast: {
        selectSession: 'Please choose a session.',
        selectAtLeastOne: 'Select at least one session.',
        selectValidPass: 'Choose a valid pass.',
        singleUnavailableWithPass:
          'With an active pass for this course, single-session payment isn’t available.',
        sessionNoLongerAvailable: 'One of the sessions is no longer available.',
        passNotForCourse: 'This pass isn’t valid for this course.',
        passEntriesLimitReached:
          'You’ve reached your pass limit. Please buy a new pass for more lessons.',
        cancelNoLesson: 'Cannot cancel (no lesson).',
        noActiveBooking: 'No active booking found.',
        cancelled: 'Booking cancelled.',
        errorPrefix: 'Error: ',
        singleCannotCancel: 'Single-session bookings cannot be cancelled.',
      },
      success: {
        one: '✓ Booking confirmed!',
        many: '✓ {{n}} bookings confirmed!',
      },
      selectedCount: '{{n}} sessions selected',
    },
    kal: {
      duration: 'Duration',
      spots: 'Places available',
      cancelBooking: 'Cancel booking',
    },
    catalog: {
      validAllCourses: 'Valid for all courses',
      selectedCoursesDetail: 'Selected courses (see details)',
    },
    courses: {
      noActiveCourses: 'No active courses',
      badgeFull: 'full',
      badgeSpots: 'places available',
      detailLink: 'Course details →',
      lessonListTitle: 'All scheduled dates',
      photoAlt: 'Course photo',
      noDates: 'No dates available',
      optionFullSuffix: 'full',
      backToCourses: 'Back to courses',
      capacitySpots: 'places',
      spotsFree: 'free',
      perSession: 'session',
      gallery: 'Gallery',
      enlargePhoto: 'Enlarge photo',
      instructor: 'Instructor',
      scheduleLabel: 'Schedule',
      freeCancellation: 'Free cancellation',
      ahead: 'in advance',
      scheduledDates: 'Scheduled dates',
      allSessionsFull: 'All sessions are full.',
      noScheduledSessionsShort: 'No scheduled sessions.',
      galleryPrev: 'Previous photo',
      galleryNext: 'Next photo',
    },
    payment: {
      externalTitle: 'Payment method',
      externalLead:
        'Payment is taken only on Stripe’s secure checkout (outside this app). This app does not process card data or payments.',
      externalMissingUrl:
        'No Stripe link is set for this item. In index.html, set window.__externalStripePayments (passDefault / singleLessonDefault / byPassId / byCourseId).',
      payStripe: 'Pay with Stripe',
      stripeMissingToast: 'Stripe link is missing.',
      stripeOpenedToast:
        'We opened Stripe in a new tab. We’ll activate your booking or pass once payment is received.',
      summaryPass: 'Pass',
      summaryPrice: 'Price',
      summarySessionAfterPay: 'Chosen session (booking completed after payment)',
      summaryCourse: 'Course',
      summarySession: 'Session',
      validUntil: 'Valid until {{date}}',
    },
    purchase: {
      confirmComplete: 'Do you want to complete this purchase?',
      duplicatePass:
        'You already have an active pass of this type. Buy again anyway? This may be a duplicate purchase.',
      passPurchased: '✓ Pass purchased.',
      passPurchaseErrorPrefix: 'Purchase error: ',
    },
    shop: {
      signInPrompt: 'Please sign in.',
      loading: 'Loading…',
      emptyCatalog: 'No passes are available right now.',
      fetchError: 'Could not load passes.',
      validityOneWeek: 'Valid for one week after purchase',
      validityWeeksMany: 'Valid for {{weeks}} weeks after purchase',
    },
  },
}

const LOCALE_FALLBACK = 'cs'

/**
 * @param {'cs' | 'en'} locale
 * @param {string} path  např. 'booking.btn.confirmAndPay'
 * @param {Record<string, string | number>} [params]
 */
export function t(locale, path, params = {}) {
  const loc = locale === 'en' ? 'en' : 'cs'
  let raw = _getByPath(UI_TRANSLATIONS[loc], path)
  if (raw === undefined && loc !== LOCALE_FALLBACK) {
    raw = _getByPath(UI_TRANSLATIONS[LOCALE_FALLBACK], path)
  }
  if (typeof raw !== 'string') {
    console.warn('[t] Missing translation:', loc, path)
    return path
  }
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = params[key]
    return v !== undefined && v !== null ? String(v) : `{{${key}}}`
  })
}

function _getByPath(obj, path) {
  if (!obj || !path) return undefined
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[p]
  }
  return cur
}
