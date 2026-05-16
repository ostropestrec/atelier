<script lang="ts">
  import { courses } from '../../bridge/courses'
  import { upcomingLessons } from '../../bridge/lessons'
  import { lang, tt } from '../../bridge/i18n'
  import { selectedDay } from './state'
  import type { Course, Lesson, LocalizedText } from '../../../atelier-api'

  function toISODate(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${dd}`
  }

  const dayOptions: Date[] = $derived.by(() => {
    const out: Date[] = []
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    for (let i = 0; i < 14; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      out.push(d)
    }
    return out
  })

  const lessonsForDay: readonly Lesson[] = $derived(
    $upcomingLessons.filter((l) => toISODate(new Date(l.start_time)) === $selectedDay)
  )

  function courseFor(courseId: Lesson['course_id']): Course | undefined {
    return $courses.find((c) => c.id === courseId)
  }

  function localized(field: LocalizedText | undefined): string {
    if (!field) return ''
    return field[$lang] ?? field.cs ?? ''
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso)
    const locale = $lang === 'en' ? 'en-GB' : 'cs-CZ'
    return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }

  function fmtDayLabel(d: Date): string {
    const locale = $lang === 'en' ? 'en-GB' : 'cs-CZ'
    return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  }

  function open(lesson: Lesson): void {
    const c = courseFor(lesson.course_id)
    if (!c) return
    window.AtelierAPI.actions.openBookingPopup(c.id, null, lesson.lesson_id)
  }
</script>

<section class="cal-island" aria-label={$tt('nav.calendar')}>
  <header class="cal-island__head">
    <strong>{$tt('nav.calendar')}</strong>
  </header>

  <nav class="cal-island__days" aria-label="day picker">
    {#each dayOptions as day}
      {@const iso = toISODate(day)}
      <button
        type="button"
        class="cal-island__day"
        class:active={iso === $selectedDay}
        onclick={() => selectedDay.set(iso)}
      >
        {fmtDayLabel(day)}
      </button>
    {/each}
  </nav>

  <ul class="cal-island__list">
    {#each lessonsForDay as l (l.lesson_id)}
      {@const c = courseFor(l.course_id)}
      <li class="cal-island__item">
        <div class="cal-island__title">{localized(c?.title)}</div>
        <div class="cal-island__time">{fmtTime(l.start_time)}–{fmtTime(l.end_time)}</div>
        <div class="cal-island__spots" aria-hidden="true">{l.available_spots}</div>
        <button
          type="button"
          class="cal-island__book"
          disabled={l.available_spots <= 0}
          onclick={() => open(l)}
        >
          {l.available_spots > 0 ? $tt('booking.btn.book') : $tt('common.full')}
        </button>
      </li>
    {:else}
      <li class="cal-island__empty">{$tt('booking.empty.noScheduledSessions')}</li>
    {/each}
  </ul>
</section>

<style>
  .cal-island {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 4px 0;
  }

  .cal-island__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 18px;
    font-weight: 600;
  }

  .cal-island__days {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
  }

  .cal-island__day {
    flex: 0 0 auto;
    padding: 8px 14px;
    border-radius: 999px;
    border: 1px solid var(--border, rgba(17, 24, 39, 0.1));
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }

  .cal-island__day.active {
    background: var(--primary, #2854b9);
    color: #fff;
    border-color: transparent;
  }

  .cal-island__list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }

  .cal-island__item {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    border: 1px solid var(--border, rgba(17, 24, 39, 0.1));
    border-radius: 14px;
    background: var(--surface, #fff);
  }

  .cal-island__title { font-weight: 600; }
  .cal-island__time { color: var(--muted, #6b7280); font-variant-numeric: tabular-nums; }
  .cal-island__spots { color: var(--muted, #6b7280); font-variant-numeric: tabular-nums; min-width: 1.5ch; text-align: right; }

  .cal-island__book {
    padding: 8px 16px;
    border-radius: 999px;
    border: none;
    background: var(--primary, #2854b9);
    color: #fff;
    cursor: pointer;
    font: inherit;
    font-weight: 500;
  }

  .cal-island__book:disabled {
    background: var(--muted-surface, #f6f7f9);
    color: var(--muted, #6b7280);
    cursor: not-allowed;
  }

  .cal-island__empty {
    padding: 24px;
    text-align: center;
    color: var(--muted, #6b7280);
    border: 1px dashed var(--border, rgba(17, 24, 39, 0.1));
    border-radius: 14px;
  }
</style>
