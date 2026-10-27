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
- Headline display serif: `Bodoni Moda` (weight 800-900). (Alt: Playfair Display 900.)
- Nav / labels / button (wide-tracked uppercase sans): `Jost` (weight 500-600,
  letter-spacing 0.18-0.22em). (Alt: Montserrat.)
- Body: `Jost` / system sans.

## Layout
- Top nav thin bottom border. Left anchors, right GitHub icon + menu icon.
- Hero subject left ~50% bleed; red vertical beam; floor reflection.
- Text block right: 2-line label, red word, mint phrase, divider, paragraph,
  outlined pill button.
- Vertical counter "01 — 03" far right, clickable, keyboard.
- Thumbnail card bottom right detail crop.
- 3-slide carousel, 6s auto, pause on hover.
- Features 4 dark cards. How it works flow. Final CTA + footer.

## Assets
- `/assets/spiderman.png` MISSING. Need cutout or blend via mask/gradient.
- `/assets/landing-reference.jpg` MISSING. Sampling blocked.

## Files containing "the previous name"
- `frontend/src/components/layout/Sidebar.tsx` -> CodeXray.
- `frontend/src/api/mock/data.ts` (`the previous name-backend`) -> keep sample.
- `CodeXray/Frontend/index.html` -> CodeXray.
- `frontend/dist/assets/*` -> regenerated.

## Plan
Phase 2 rename, Phase 3 routing, Phase 4 hero, Phase 5 sections, quality.
STOP. Waiting for "continue" and missing assets.
