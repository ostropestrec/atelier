// ============================================================
// svelte/main.ts — island registry + jediný __appNavHooks listener.
// Build artefakt (dist/atelier-svelte.js) je natažen jako poslední
// <script type="module"> v index.html, po vanilla modulech.
// ============================================================

import { mount, unmount, type Component } from 'svelte'
import Calendar from './islands/calendar/Calendar.svelte'

interface MountedInstance {
  component: ReturnType<typeof mount>
  name: string
}

const REGISTRY: Record<string, Component<any>> = {
  calendar: Calendar as unknown as Component<any>
}

const ACTIVE: Map<Element, MountedInstance> = new Map()

function mountIsland(
  name: string,
  target: Element,
  props: Record<string, unknown> = {}
): ReturnType<typeof mount> | null {
  if (!target) return null

  const existing = ACTIVE.get(target)
  if (existing && existing.name === name) return existing.component
  if (existing) unmountIsland(target)

  const Comp = REGISTRY[name]
  if (!Comp) {
    console.warn('[svelte-islands] Unknown island:', name)
    return null
  }

  const instance = mount(Comp, { target, props })
  ACTIVE.set(target, { component: instance, name })
  return instance
}

function unmountIsland(target: Element): void {
  const entry = ACTIVE.get(target)
  if (!entry) return
  unmount(entry.component)
  ACTIVE.delete(target)
}

if (typeof window !== 'undefined') {
  window.AtelierSvelte = { mount: mountIsland, unmount: unmountIsland }

  window.__appNavHooks = window.__appNavHooks ?? []
  window.__appNavHooks.push((id: string) => {
    const root = document.getElementById('calendar-root')
    if (!root) return

    const featureOn = window.__features?.svelteCalendar === true
    if (id === 'kalendar' && featureOn) {
      mountIsland('calendar', root)
    } else {
      unmountIsland(root)
    }
  })

  const initialActive = document.querySelector('#screen-kalendar.active')
  if (initialActive && window.__features?.svelteCalendar) {
    const root = document.getElementById('calendar-root')
    if (root) mountIsland('calendar', root)
  }
}
