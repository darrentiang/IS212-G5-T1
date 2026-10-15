import '@testing-library/jest-dom/vitest'

// jsdom has no ResizeObserver; Layout measures its header with one. This
// stand-in reports once when observing starts, as a browser does.
globalThis.ResizeObserver ??= class {
  constructor(callback) {
    this.callback = callback
  }
  observe(target) {
    this.callback([{ target }], this)
  }
  disconnect() {}
}

// jsdom does not lay pages out, so it has no scrollIntoView; app/reveal.js
// calls it. A spy, so a test can assert that a form was brought into view.
Element.prototype.scrollIntoView = vi.fn()
