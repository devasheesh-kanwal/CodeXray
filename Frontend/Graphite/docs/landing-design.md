# Landing page design (CodeXray)

Reference image `/assets/landing-reference.jpg` and hero subject `/assets/spiderman.png`
were **not found** in this workspace. Colors below are proposed from the written
spec (near-black green bg, red headline, mint secondary, red beam) and must be
confirmed against the reference once provided. Sampling could not be performed.

## Colors (proposed, hex)
- Background (near-black green): `#081412`
- Surface (cards): `#111A17`
- Headline red: `#FF3333`
- Secondary text (mint/off-white): `#C8F0E4`
- Muted text: `#8FA8A0`
- Red light beam: `rgba(255, 51, 51, 0.35)` -> transparent vertical gradient
- Divider lines (thin): `rgba(200, 240, 228, 0.14)`
- Card border: `rgba(200, 240, 228, 0.08)`
- Red accent (buttons/borders): `#FF3333`

## Fonts
- Headline display serif: `Bodoni Moda` (weight 800-900), closest high-contrast
  serif match to the reference. (Alternative: Playfair Display 900.)
- Nav / labels / button (wide-tracked uppercase sans): `Jost` (weight 500-600,
  letter-spacing 0.18-0.22em). (Alternative: Montserrat.)
- Body: `Jost` / system sans.

Fonts to be loaded from Google Fonts (no new npm library; CSS `@import`).

## Layout
- Top nav: thin bottom border (`1px` divider). Left: HOME, FEATURES, HOW IT
  WORKS, ABOUT (smooth-scroll anchors). Right: GitHub icon link + menu icon
  (mobile). No search/bag icons.
- Hero: subject image fills left ~50%, bleeds off left and bottom edges; red
  vertical light beam behind subject; glossy red floor reflection.
- Text block right: small 2-line label "SAME CODE / NEW PERSPECTIVES"; giant
  red word; large mint phrase; short divider line; paragraph; outlined pill
  button "GET STARTED" with arrow.
- Vertical counter "01 — 03" at far right, clickable, keyboard accessible.
- Small rounded thumbnail card bottom right: detail crop of subject.
- 3-slide carousel, auto-advance 6s, pause on hover.
- Features: 4 dark cards with red accents + line icons.
- How it works: repair loop flow (branch, fix, test, eval gate, human approval).
- Final CTA + slim footer.

## Assets
- `/assets/spiderman.png` MISSING. Need a cutout (transparent PNG) or permission
  to blend via mask/gradient fade. If a solid/bright background is present, blend
  with radial gradient mask into `#081412` and floor reflection.
- `/assets/landing-reference.jpg` MISSING. Color/font sampling blocked.

## Files containing "the previous name" (case-insensitive)
- `frontend/src/components/layout/Sidebar.tsx` (UI logo) -> rename to CodeXray.
- `frontend/src/api/mock/data.ts` (sample repo name `the previous name-backend`) -> KEEP
  (approved sample name).
- `CodeXray/Frontend/index.html` (meta description) -> rename to CodeXray.
- `frontend/dist/assets/*` (build artifact) -> regenerated on build.

## Plan
1. Phase 2: rename the previous name -> CodeXray everywhere except approved sample names.
2. Phase 3: routing. `/` landing (no shell); app under `/repos`, `/explorer`,
   `/ask`, `/pr-review`, `/repair`, `/status` with existing shell; Get Started ->
   `/repos`; sidebar logo links to `/`; 404 page; fix links/redirects.
3. Phase 4: hero (carousel, spiderman, beam, reflection, thumbnail, animations,
   responsive).
4. Phase 5: features, how-it-works, final CTA, footer.
5. Quality: strict TS, tokens, optimize image, preload, a11y, build passes.
STOP. Waiting for "continue" and the missing assets.
