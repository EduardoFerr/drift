import { describe, expect, it, beforeEach } from 'vitest'
import {
  useLayerStack,
  pushLayer,
  popLayer,
  replaceLayer,
  hasLayer,
  topLayerId,
  clearLayers,
  type LayerDef,
} from '../src/lib/layer-stack'

const Stub = () => null

function makeDef(id: string, extra?: Partial<LayerDef>): LayerDef {
  return { id, component: Stub, ...extra }
}

function ids(): string[] {
  return useLayerStack.getState().layers.map((l) => l.id)
}

describe('layer-stack', () => {
  beforeEach(() => {
    clearLayers()
  })

  // ─── push ──────────────────────────────────────────────────────────

  describe('pushLayer', () => {
    it('adds layer to empty stack', () => {
      pushLayer(makeDef('a'))
      expect(ids()).toEqual(['a'])
    })

    it('adds layer to existing stack', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      expect(ids()).toEqual(['a', 'b'])
    })

    it('idempotent — duplicate id is no-op', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('a'))
      expect(ids()).toEqual(['a'])
    })

    it('preserves props', () => {
      pushLayer(makeDef('a', { props: { foo: 42 } }))
      expect(useLayerStack.getState().layers[0]?.props).toEqual({ foo: 42 })
    })

    it('preserves parent', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b', { parent: 'a' }))
      expect(useLayerStack.getState().layers[1]?.parent).toBe('a')
    })

    it('preserves dismiss config', () => {
      pushLayer(makeDef('a', { dismiss: ['backdrop'] }))
      expect(useLayerStack.getState().layers[0]?.dismiss).toEqual(['backdrop'])
    })
  })

  // ─── pop ───────────────────────────────────────────────────────────

  describe('popLayer', () => {
    it('pops topmost when no args', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      popLayer()
      expect(ids()).toEqual(['a'])
    })

    it('no-op on empty stack', () => {
      popLayer()
      expect(ids()).toEqual([])
    })

    it('pops specific id', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      popLayer({ id: 'a' })
      expect(ids()).toEqual(['b'])
    })

    it('pops id + all descendants', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b', { parent: 'a' }))
      pushLayer(makeDef('c', { parent: 'b' }))
      popLayer({ id: 'a' })
      expect(ids()).toEqual([])
    })

    it('pops only target and descendants, not siblings', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b', { parent: 'a' }))
      pushLayer(makeDef('x'))
      popLayer({ id: 'a' })
      expect(ids()).toEqual(['x'])
    })

    it('pops leaf child without affecting parent', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b', { parent: 'a' }))
      popLayer({ id: 'b' })
      expect(ids()).toEqual(['a'])
    })

    it('no-op when id not found', () => {
      pushLayer(makeDef('a'))
      popLayer({ id: 'nonexistent' })
      expect(ids()).toEqual(['a'])
    })
  })

  // ─── replace ───────────────────────────────────────────────────────

  describe('replaceLayer', () => {
    it('replaces layer at same position', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      pushLayer(makeDef('c'))
      replaceLayer('b', makeDef('B'))
      expect(ids()).toEqual(['a', 'B', 'c'])
    })

    it('removes descendants of replaced layer', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b', { parent: 'a' }))
      pushLayer(makeDef('c', { parent: 'b' }))
      replaceLayer('a', makeDef('A'))
      expect(ids()).toEqual(['A'])
    })

    it('no-op when id not found', () => {
      pushLayer(makeDef('a'))
      replaceLayer('nonexistent', makeDef('x'))
      expect(ids()).toEqual(['a'])
    })
  })

  // ─── has ───────────────────────────────────────────────────────────

  describe('hasLayer', () => {
    it('true when present', () => {
      pushLayer(makeDef('a'))
      expect(hasLayer('a')).toBe(true)
    })

    it('false when absent', () => {
      expect(hasLayer('a')).toBe(false)
    })

    it('false after pop', () => {
      pushLayer(makeDef('a'))
      popLayer({ id: 'a' })
      expect(hasLayer('a')).toBe(false)
    })
  })

  // ─── topLayerId ────────────────────────────────────────────────────

  describe('topLayerId', () => {
    it('null when empty', () => {
      expect(topLayerId()).toBeNull()
    })

    it('returns last pushed', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      expect(topLayerId()).toBe('b')
    })

    it('updates after pop', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      popLayer()
      expect(topLayerId()).toBe('a')
    })
  })

  // ─── clearLayers ───────────────────────────────────────────────────

  describe('clearLayers', () => {
    it('empties the stack', () => {
      pushLayer(makeDef('a'))
      pushLayer(makeDef('b'))
      clearLayers()
      expect(ids()).toEqual([])
    })
  })

  // ─── complex scenarios ─────────────────────────────────────────────

  describe('settings cascade', () => {
    it('settings → sub-card → pop sub-card → settings survives', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('filters', { parent: 'settings' }))
      expect(ids()).toEqual(['settings', 'filters'])
      popLayer({ id: 'filters' })
      expect(ids()).toEqual(['settings'])
    })

    it('settings → sub-card → pop settings → both removed', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('filters', { parent: 'settings' }))
      popLayer({ id: 'settings' })
      expect(ids()).toEqual([])
    })

    it('settings → 2 sub-cards → pop settings → all removed', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('filters', { parent: 'settings' }))
      pushLayer(makeDef('identity', { parent: 'settings' }))
      popLayer({ id: 'settings' })
      expect(ids()).toEqual([])
    })

    it('independent overlays coexist', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('profile'))
      expect(ids()).toEqual(['settings', 'profile'])
      popLayer({ id: 'profile' })
      expect(ids()).toEqual(['settings'])
    })

    it('nested grandchildren removed with root', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('identity', { parent: 'settings' }))
      pushLayer(makeDef('export', { parent: 'identity' }))
      popLayer({ id: 'settings' })
      expect(ids()).toEqual([])
    })
  })

  describe('cross-layer navigation', () => {
    it('onboarding → pop → push identity', () => {
      pushLayer(makeDef('onboarding', { dismiss: [] }))
      popLayer({ id: 'onboarding' })
      pushLayer(makeDef('identity'))
      expect(ids()).toEqual(['identity'])
    })

    it('switcher → replace with identity', () => {
      pushLayer(makeDef('settings'))
      pushLayer(makeDef('switcher', { parent: 'settings' }))
      replaceLayer('switcher', makeDef('identity', { parent: 'settings' }))
      expect(ids()).toEqual(['settings', 'identity'])
    })
  })
})
