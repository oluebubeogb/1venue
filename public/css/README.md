# 1venue CSS

`public/css/app.css` is the one stylesheet the app serves. Do not edit it by hand. The source files live in `public/css/src/`, and `scripts/build-css.js` joins them into `app.css`.

`room.css`, `legal.css` and `/features/features.css` are separate files and are not part of this build.

## Folder map

| Folder | What goes there |
| --- | --- |
| `00-base/` | `10-tokens.css` holds design tokens, shade layers, the reset and focus rings. `20-typography.css` is the type scale. `30-shell.css` is the app shell, top and bottom nav, and the Books picker. `40-utilities.css` holds shared helpers, the mobile overflow guard and reduced motion. |
| `10-components/` | Shared UI, one file per component: avatar, buttons, cards, chips, command-bar, composer, credit-badge, form-rows, icon-buttons, inputs, lists, modals, panels, passage-card, post, promoted, qr, sounds, stats, tabs, tooltip, verified-badge. |
| `20-pages/` | One file per page: admin, attendance, auth, bible, create, dashboard, discover, event, feed, home, plans, profile, settings, venues, wallet, whiteboard. |

Each file keeps its mobile `@media` blocks next to the rules they change. No file is longer than about 300 lines.

## Joining order (why some names are numbered)

The build sorts the files by folder, then by file name. It uses numeric-aware sorting, so base comes first, then components, then pages. Most rules do not depend on order. A few do, and they are kept in place as follows:

- **`00-base` files are numbered.** Tokens, including `:focus-visible` and the reset, have to come before the shell rules, which override some of them.
- **`form-rows.css` sorts before `inputs.css`.** That way `select.tr-select { max-width: 9rem }` still beats the generic `.set-row > select` rule.
- **The `[data-group]` colour rules live in `buttons.css`.** They sit after `.icon-btn` and before `.chip` and `.cmd-act`, so each colour group keeps its `--g` value.
- **Page files come after components.** A page rule with the same specificity as a component rule wins.

If you move a rule to another file, check whether a rule of equal specificity in another file sets the same property on the same element. If one does, the move changes which rule wins.

## How to build

```bash
npm run build:css    # write public/css/app.css from public/css/src/
npm run check:css    # exit 1 if app.css does not match the sources
```

`npm test` and `npm run test:sqlite` both run `check:css` first. The Dockerfile also runs `node scripts/build-css.js`. The generated `app.css` is committed too, so a deploy that skips that step still has a stylesheet.

`scripts/diff-css-normalize.js old.css new.css` compares two stylesheets rule by rule, ignoring comments and formatting. Use it to confirm that a change which should not change any rules really doesn't.

## How the Phase B consolidation was checked

The fix and override blocks were folded into their home rules. Exact duplicates and fully overridden declarations were removed.

To check the result, every page below was loaded with the old `app.css`, the stylesheet was swapped for the new one, and `getComputedStyle` was compared for every element and its `::before`/`::after`. The pages, at 1280px and 390px, were home, discover, an event page, login, signup, feed, create, dashboard, settings, wallet, upgrade, billing, venues, books, bible, whiteboard, materials, sessions, me, a profile page, host and search, plus home and event while logged in. The comparison found no differences.

Screenshots at the same widths also matched pixel for pixel.

After a CSS change that will ship, bump `?v=` on `/css/app.css` in `public/index.html` and the `VERSION` string in `public/sw.js`. `public/js/ui.js` reads the `app.css?v=` query string as the build id; leave that as it is.

## Part 2: Rules for future CSS work

1. **Edit the source files, never the joined `app.css`.** Run `npm run build:css` after every change. Tests fail if you forget.
2. **Put it where it belongs.**
   - A design value, like a colour, spacing or radius, goes in `00-base/10-tokens.css` as a CSS variable. Pages use `var(--...)` and never hard-code colours.
   - Something used on two or more pages goes in `10-components/`.
   - Something used on one page only goes in `20-pages/<page>.css`, and every rule there starts with that page's root class (for example `.page-feed ...`), so it can't leak onto other pages.
   - A new page gets a new file in `20-pages/`.
3. **No fix blocks at the bottom of the file.** If something is wrong, fix the original rule. No sections called "v7 fix", "patch" or "override".
4. **Mobile rules go next to the rule they change**, as a `@media` block in the same file, not in a separate mobile section. Use the shared breakpoints from `10-tokens.css`: 600px for phones and 1024px for tablets.
5. **Keep specificity low.** Use classes only, with no IDs and no `!important`. The exception is the install-overlay safety rule in `index.html`. Nest at most three levels.
6. **Name things clearly.** Use simple kebab-case, prefixed by component or page (`.cmd-bar-input`, `.feed-rail`). Keep existing names, and only rename a class if you also update the JS that uses it.
7. **Text sizes come from the type scale** in `00-base/20-typography.css`. Don't add one-off font sizes or large headers.
8. **Every visual change needs before-and-after screenshots** at 1280px and 390px of the pages it affects.
9. **Bump `?v=` in `index.html`** and the service worker cache version whenever the CSS changes in a release, so users don't get stale styles.
10. **Feature styles:** if a feature lives in `src/features/<id>/`, its styles go in `features.css` (or its own feature folder if that pattern exists), not in `app.css`.
11. **Before deleting a class,** search `public/js/` and `src/` for it.
12. **Keep files under about 300 lines.** If one grows larger, split it by sub-component.
