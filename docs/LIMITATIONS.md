# Known limitations

- Exploration is bounded observation. A passing map or benchmark does not establish that
  every application state, permission defect, or vulnerability was found.
- Incremental reuse is accepted only for compatible context and mapped route/selector
  changes. Unknown scope falls back to full mapping; declared scope can still be wrong.
- Framework adapters use stable explicit signals where possible and fall back to
  black-box semantics. They do not inspect private React/Vue component internals.
- Exact replay can fail when test data, authentication, time, randomization, or selectors
  change. Narrow locator fallback deliberately prefers false negatives to unsafe clicks.
- The Playwright importer supports literal statically recoverable constructs and reports
  unsupported dynamic control flow rather than executing source.
- Extension workers are not a security sandbox. Enable only reviewed local code.
- SQLite in Node.js 24 is still reported by Node as experimental; JSON artifacts remain
  the authoritative portable representation.
- The StateScry name and package/repository ownership still require final trademark and
  registry review before a public release. Packages are built and smoke-tested locally
  but are not published.
