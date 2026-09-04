import '@testing-library/jest-dom'

// Files that opt into the node environment (`@vitest-environment node`) share
// this setup but have no window; the browser shims below only apply where a
// browser is being simulated.
if (typeof window !== 'undefined') {
  // Mock matchMedia for theme detection
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })

  // Mock localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }
  })()

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
  })

  // Mock clipboard API
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: () => Promise.resolve(),
    },
  })

  // jsdom lacks IntersectionObserver (used by the scroll-spy table of contents).
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    writable: true,
    value: IntersectionObserverStub,
  })

  // jsdom does not implement scrollIntoView; provide a no-op so navigation works.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})
}
