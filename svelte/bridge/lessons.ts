import type { Lesson } from '../../atelier-api'
import { createBridgeStore } from './_factory'

export const upcomingLessons = createBridgeStore<readonly Lesson[]>(
  window.AtelierAPI.events.LESSONS_UPDATED,
  () => window.AtelierAPI.state.getUpcomingLessons(),
  []
)
