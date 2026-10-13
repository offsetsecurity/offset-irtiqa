# 3. Preact and htm for the front end

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The product exists twice: as three polished single-file HTML tools that people
have actually used, and as this application, which so far has a login page and
one list. Phase 1 of the [roadmap](../roadmap.md) ports the first real screen
across, and that port sets the pattern for roughly thirty more.

The HTML tools build every screen by assigning a template string to
`innerHTML`, with `onclick="fn()"` attributes for behaviour. That works
beautifully at 800 KB in one file. It does not survive the move here, for two
reasons:

1. **The API sends a strict Content-Security-Policy.** Inline event handler
   attributes are blocked outright. Every `onclick=` in the tools has to become
   a bound listener regardless of what else we choose.
2. **Replacing `innerHTML` destroys state.** Anything typed into a field, the
   scroll position, which row was focused — all lost on every re-render. A
   dashboard can get away with that. A controls table with inline editing, which
   is most of this product, cannot.

So a straight copy-paste port was never available. Given that, the question is
what to port *to*.

## Decision

**Preact with htm.** Together about 5 KB compressed, bundled at build time by
esbuild, no CDN and no runtime download — which matters for offline installs.

htm is the reason this pairing wins over the alternatives. It uses tagged
template literals, so a screen from the HTML tool moves across almost
unchanged:

```js
// in the HTML tool
v.innerHTML = `<div class="card pad"><h2>${title}</h2></div>`;

// here
return html`<div class="card pad"><h2>${title}</h2></div>`;
```

The markup is the same text. What changes is that the result is a virtual DOM
tree rather than a string, so Preact updates only what actually differs, and
event handlers are real function references rather than global names in an
attribute.

**Routing is hash-based** (`#/dashboard`). The server already falls back to
`index.html`, so real paths would work — but hash routing keeps working when a
customer hosts the app under a subpath or behind a proxy that rewrites URLs. On
an on-premise product installed by other people, that robustness is worth more
than a tidier address bar.

**No JSX.** htm needs no compile step, so `.ts` files stay `.ts`, esbuild
configuration stays as it is, and there is no build-time transform between what
is written and what runs.

## Consequences

**Good**

- Porting screens is mostly mechanical, which is exactly what Phase 3 needs
  when the same work is repeated five times.
- Inline editing behaves: focus, scroll and selection survive a re-render.
- The bundle stays small enough to be irrelevant, and ships inside the image.
- Preact's API is React's, so the knowledge transfers if this ever needs more
  hands.

**Bad**

- A dependency where there were none. Two, counting htm.
- Templates are not type-checked. TypeScript checks the code around them but
  cannot see inside a tagged template, so a typo in a prop name is found at
  runtime. Accepted deliberately: JSX would fix it and costs a build transform
  and a much less mechanical port.
- One more idea for a future maintainer to learn, though a small one.

**Rejected — plain JavaScript with a render helper**

Genuinely tempting: no dependencies at all, and closest to the tools. Rejected
because the focus-loss problem is not cosmetic. The controls screen is a table
of 106 rows with editable status and owner on each, and rebuilding it on every
keystroke is not something a helper function fixes without becoming a small
virtual DOM of our own — worse than the 5 KB one that already exists.

**Rejected — React**

Same programming model at roughly nine times the size, a heavier build, and an
ecosystem this application does not draw on. Preact gives the part we want.
