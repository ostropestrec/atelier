import type { Course } from '../../atelier-api'
import { createBridgeStore } from './_factory'

export const courses = createBridgeStore<readonly Course[]>(
  window.AtelierAPI.events.COURSES_UPDATED,
  () => window.AtelierAPI.state.getCourses(),
  []
)
