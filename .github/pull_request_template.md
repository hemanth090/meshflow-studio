## Summary

<!-- What does this pull request change, and why? Link the related issue if there is one. -->

## What changed

<!-- Bullet the user-visible and/or internal changes. -->

-

## Type of change

- [ ] Bug fix
- [ ] New feature (preset, palette, control, export option, …)
- [ ] Refactor / performance
- [ ] Documentation or release scaffolding
- [ ] Other (describe above)

## Checklist

- [ ] `node --check` passes for every changed `src/*.js` fragment (and `node --check client.js`).
- [ ] `node build.mjs` ran and the regenerated `client.js` is committed with this PR.
- [ ] `node --test test/*.mjs` passes; new behaviour has a test and a bug fix has a regression test.
- [ ] New visible strings exist in **both** `en` and `zh`, and are rendered through `t()`.
- [ ] Chrome styling uses `var(--dsw-alias-*)` theme tokens only; literal colours are artwork-only.
- [ ] Accessibility checked: accessible names, keyboard operation, visible focus ring, correct ARIA roles/states.
- [ ] No new runtime dependencies, no network calls, no DOM access outside refs/effects, no state mutation.
- [ ] Docs updated (`README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`) when behaviour changes.
- [ ] The diff is scoped to this change and does not reformat unrelated code.

## Screenshots / recordings

<!-- For visual changes, add before/after captures (light and dark theme when relevant). -->
