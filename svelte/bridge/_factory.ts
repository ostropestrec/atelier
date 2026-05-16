import { writable, type Readable } from 'svelte/store'
import type { AtelierEventName } from '../../atelier-api'

/**
 * createBridgeStore — read-only zrcadlo nějakého řezu vanilla AppState.
 *
 * Vrací výhradně Readable<T> (žádný set/update). Zápis do AppState
 * jde výhradně přes AtelierAPI.actions.* → vanilla → emit eventu →
 * tento store se přečte znovu.
 */
export function createBridgeStore<T>(
  eventName: AtelierEventName,
  read: () => T,
  initial?: T
): Readable<T> {
  const store = writable<T>(initial ?? read())
  if (typeof window !== 'undefined') {
    window.AtelierAPI.events.on(eventName, () => store.set(read()))
  }
  return { subscribe: store.subscribe }
}
