# BrioCare PRD — image brief

Seven illustrations for `docs/prd.html`. Each prompt is self-contained: copy one block,
paste into the image tool, save under `docs/img/` with the given filename.

**Priority** — if time-boxed, generate 1, 2, 4, 5 first. Those four carry the argument.

**Conventions**
- Save as PNG at the stated aspect; I'll convert to WebP and inline as data URIs
  (artifacts have a strict CSP — no external hosts — and a 16MB rendered cap).
- Every image sits on its own warm-paper ground and is framed as a plate in the doc,
  so it reads correctly in both light and dark mode.
- Every prompt bans text. Image models garble lettering; all labels get overlaid in HTML.
- Exact figure counts may drift in generation. That's fine — the captions carry the numbers.

---

## 1 · `hero-second-chair.png` — masthead, above section 01
**Why:** first thing a reviewer sees; states the thesis before a word is read.
**Aspect:** 2:1 (target 2400×1200)

> A circle of chairs that is also a video call. Eight rounded-rectangle screen tiles
> arranged in a gentle arc, like chairs pulled into a therapy circle seen from slightly
> above. Each tile holds one stylized child, seated, listening. At the near end of the
> arc sit two tiles set slightly apart: one holds the therapist, an adult figure leaning
> forward; the tile beside her — the second chair — holds no person at all, but a calm
> soft-edged sage form with a quiet attentive presence, clearly a participant rather than
> a decoration. Composition is wide, unhurried, generous negative space above the arc.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained — this belongs in a beautifully designed
> annual report, not a tech marketing site. Palette strictly: warm off-white paper #EFF1EE;
> deep sage #1F6F5C and darker sage #134B3E; soft sage tint #E2EDE8; near-black #161C19 for
> line work; one accent, muted clay red #A63F35, on at most one element. People are
> stylized and simplified, faces reduced to minimal marks — no detailed features, no
> uncanny realism — diverse in skin tone and hair rendered as flat ink tints. Warm and
> dignified, never cute-corporate, never sad-clipart.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 2 · `brio-character.png` — section 05, "The heads-up loop"
**Why:** the PRD names Brio constantly and never shows it. Also feeds the build —
the worker publishes Brio as a real participant tile, so this settles what renders there.
**Aspect:** 3:1 (target 2400×800) — a three-up row
**Note:** deliberately *not* a humanoid robot (implies more agency than it has) and *not*
an animal (that's the pets' job). Puppet-adjacent: the PRD says Brio enters the room the
way therapy puppets always have.

> A character sheet: the same soft companion shown three times in a row, left to right,
> each inside its own rounded-rectangle video tile of equal size. The character is a
> simple rounded felt-puppet form in deep sage — no limbs, no robot parts, no screen face,
> no mechanical detail — with two small dark dot eyes and a minimal calm mouth. It reads as
> handmade and warm, a little like a beloved children's public-television puppet.
> Left tile — listening: upright, eyes open, entirely still, a faint soft ring of paler
> sage around it. Center tile — about to speak: leaning very slightly forward, eyes open
> and brighter, a clearer soft halo, one small clay-red mark at the tile's edge as the only
> saturated color in the whole image. Right tile — muted: dimmed to a pale tint, eyes
> gently closed, halo gone, at rest and unmistakably not acting. The three states must
> differ at a glance while the character stays identical.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained. Palette strictly: warm off-white paper
> #EFF1EE; deep sage #1F6F5C and darker sage #134B3E; soft sage tint #E2EDE8; near-black
> #161C19 for line work; one accent, muted clay red #A63F35, used once only.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 3 · `two-jobs-one-therapist.png` — section 02, "The pain, quantified"
**Why:** the dynamic-administrator / analyst-interpreter split is the whole reason the
second chair exists. The riso misregistration does the work: the two jobs literally
become two ink plates of one person.
**Aspect:** 3:2 (target 1800×1200)

> One therapist at a desk, seen from behind and slightly to the side, facing a screen that
> fills with a grid of many small child tiles — enough tiles that the grid runs past the
> edge of the frame and feels like more than one person can hold. The therapist is printed
> twice, as two offset ink plates of the same figure: one plate leans forward with a hand
> raised, running the room and speaking; the other plate, offset a few millimetres and in
> a second ink, leans back with a hand at her chin, watching and holding a pen. Same
> person, same chair, two jobs happening at once. The offset should look like a deliberate
> printing effect, not a blur or a ghost. Quiet, sympathetic, not comic.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained. Palette strictly: warm off-white paper
> #EFF1EE; deep sage #1F6F5C and darker sage #134B3E; soft sage tint #E2EDE8; near-black
> #161C19 for line work; one accent, muted clay red #A63F35, on at most one element. People
> are stylized and simplified, faces reduced to minimal marks — no detailed features, no
> uncanny realism.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 4 · `quiet-child.png` — section 05, the draw-out ladder
**Why:** the child the product exists for. This is the emotional thesis —
"acts, not seconds" — in one frame.
**Aspect:** 4:3 (target 1600×1200)

> A single child close up inside their own rounded-rectangle video tile, filling most of
> the frame. The child sits attentive and still, listening, hands resting near a keyboard,
> microphone off — present and engaged, on the edge of joining, but not speaking. Not sad,
> not excluded: waiting for a way in. Behind and around them, much smaller and printed in
> a pale sage tint, the rest of the group's tiles are lively with abstract speech shapes,
> so the loud room recedes and the quiet child is the only figure in full ink. In the
> lower corner of the child's own tile, a small soft card offers a low-pressure way to
> participate: two blank rounded buttons and one warm reaction shape — completely blank,
> no writing or icons of any kind. Composition is intimate and warm.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained. Palette strictly: warm off-white paper
> #EFF1EE; deep sage #1F6F5C and darker sage #134B3E; soft sage tint #E2EDE8; near-black
> #161C19 for line work; one accent, muted clay red #A63F35, on at most one element. People
> are stylized and simplified, faces reduced to minimal marks — no detailed features, no
> uncanny realism.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 5 · `parallel-airtime.png` — section 03, "The scaling mechanism"
**Why:** the load-bearing business argument — serial airtime divides, parallel airtime
multiplies — and right now it's pure prose.
**Aspect:** 2:1 (target 2400×1200)

> A two-panel comparison, side by side, divided by a thin vertical rule, both panels on
> the same paper.
> Left panel: one large ring of twelve stylized children seated facing inward. A single
> narrow thread of deep sage — the floor, the right to speak — winds around the whole ring,
> stretched thin as it tries to reach all twelve. It should look strained and scarce.
> Right panel: the same twelve children, now split into three smaller separate rings of
> four. Each ring has its own soft sage companion form at its center, and each ring has its
> own generous thick thread of the same sage, three times as substantial as the single
> strained thread on the left. One adult therapist figure stands between the three rings,
> moving among them along a light dotted path that touches all three. The visual argument
> must read instantly: one thin thread versus three thick ones.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained, diagrammatic but hand-printed. Palette
> strictly: warm off-white paper #EFF1EE; deep sage #1F6F5C and darker sage #134B3E; soft
> sage tint #E2EDE8; near-black #161C19 for line work; one accent, muted clay red #A63F35,
> for the therapist's dotted path only. People are stylized and simplified, faces reduced
> to minimal marks — no detailed features, no uncanny realism.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 6 · `session-pets.png` — section 05, "The child's side of the screen"
**Why:** the pet economy is described in prose and is the most memorable differentiator.
It should look genuinely charming, not generic — this is the gamification credential.
**Aspect:** 16:9 (target 1920×1080)

> An original character line-up: four simple companion creatures in a row, each shown
> twice — the top row energized, the bottom row sleepy. Energized: upright, alert, ears or
> antennae raised, printed in full deep sage with small bright eyes and a faint halo of
> movement marks. Sleepy: the same creature curled and settled, eyes closed, printed in a
> pale sage tint with the halo gone. The creatures are soft, rounded and handmade —
> cut-paper and felt puppet character design, the way a beloved children's public-
> television program would do it — original designs, not resembling any existing mascot or
> franchise. Each is distinct in silhouette so a child could pick a favorite at a glance:
> one tall and stalk-like, one round and low, one long-eared, one many-legged. Charming
> and warm, not saccharine.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work. Palette strictly: warm off-white paper #EFF1EE; deep sage
> #1F6F5C and darker sage #134B3E; soft sage tint #E2EDE8; near-black #161C19 for line
> work; one accent, muted clay red #A63F35, as a small detail on one creature only.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## 7 · `distress-flag.png` — section 06, "The boundary"
**Why:** clinicians read the safety section first. The hard-to-explain part —
nothing changes in the children's room, the human is already moving — is one image.
**Aspect:** 3:2 (target 1800×1200)

> Two zones in one frame, separated by a soft horizontal band of empty paper.
> Upper zone, printed in a pale sage tint and completely undisturbed: a grid of children's
> video tiles, the group continuing calmly, nothing interrupted. Among them the soft sage
> companion form sits with its eyes gently closed and no halo — visibly choosing silence,
> deliberately not acting.
> Lower zone, printed in full dark ink and sharply present: the therapist's screen alone,
> tilted toward the viewer, bearing one small solid clay-red marker at its edge — the only
> saturated color anywhere in the image. The therapist's hand is already entering the frame
> and reaching toward it, unhurried but decisive. The contrast in ink weight between the
> two zones carries the meaning: the children's room untouched, the human already moving.
>
> Editorial risograph-style illustration, printed in three spot inks on warm off-white
> paper. Flat shapes, no gradients, no 3D rendering, no photorealism. Visible fine paper
> grain and subtle ink texture; slight deliberate misregistration where shapes overlap.
> Confident simple line work, calm and restrained — serious without being alarming.
> Palette strictly: warm off-white paper #EFF1EE; deep sage #1F6F5C and darker sage
> #134B3E; soft sage tint #E2EDE8; near-black #161C19 for line work; muted clay red
> #A63F35 used exactly once, on the marker. People are stylized and simplified, faces
> reduced to minimal marks — no detailed features, no uncanny realism.
>
> Absolutely no text, no letters, no numbers, no words, no UI labels, no logos, no
> watermarks anywhere in the image.

---

## Deliberately not AI-generated

These belong in the PRD but should be hand-authored SVG — crisp text, theme-aware,
no garbled lettering:

- **Therapist panel mockup** (section 05) — the intent card with its exact sentence,
  the equity bars, the named-move buttons. Every pixel of it is text.
- **The airtime arithmetic** (section 02) — 45:00 → 16:00 shared floor → 1:20 per child.
- **Trigger → actor → constraints → gate** (section 06, mechanism lives in the TDD).
- **Phase timeline** (section 08).
