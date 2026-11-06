# Research: HIG and Liquid Glass on the web

The **why** behind the rules of the [design system](../contracts/design-system.md) and the [mogi experience](../contracts/experience.md). Read before changing one; the contract is what holds. The glance prototype behind them was approved, including on a real iPhone in Safari, where the edge swipe returns to the list and a sheet closes when dragged from any position.

## Sources

- HIG [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars), [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets), [Layout](https://developer.apple.com/design/human-interface-guidelines/layout), [Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities). The pages need JavaScript: read the rendered text in the browser.
- WWDC25, session 323 ([transcribed notes](https://nonstrict.eu/wwdcindex/wwdc2025/323/)).
- [WebKit #313914](https://bugs.webkit.org/show_bug.cgi?id=313914): SVG filter inside `backdrop-filter`.
- macOS 27 sidebar: [Michael Tsai](https://mjtsai.com/blog/2026/06/09/golden-gate-sidebars-and-toolbars/), [MacRumors](https://www.macrumors.com/2026/06/09/macos-golden-gate-liquid-glass/).
- Web techniques only: [DEV](https://dev.to/devyatov/liquid-glass-on-the-web-6-ways-to-build-it-with-css-and-svg-3m07), [ekino](https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d), [Aave](https://aave.com/design/building-glass-for-the-web).

## What Apple says and the rule that came out of it

**Materials.** Liquid Glass is the functional layer of controls and navigation, floating over the content; it stays out of the content layer (lists, rows, tables), except for transient controls, and is used sparingly. The *regular* variant in general; *clear* only over rich media, with 35% dimming when the media is light. The standard materials (ultraThin to thick) belong to content.
→ Glass only on toolbar, floating bar, corner button and medium sheet; content opaque.

**Dimming.** A modal sheet dims its parent; a nonmodal one does not (HIG Sheets). The 35% dimming layer is only for *clear* glass over bright media; our glass is *regular*. On the web, `backdrop-filter` samples everything painted behind the element, its own outer shadow included, so a scrim under glass grays it.
→ No scrim under glass: the glass menu sheet has none, a blocking glass alert dims around itself from a child layer, opaque modal surfaces keep one light scrim.

**Scroll edge effect.** In iOS 26 there is no glass strip behind the bar: the content itself fades and blurs at the edge where a floating control sits. *Soft* on iOS, *hard* on macOS; one per edge, only where floating UI exists.
→ `edge-mask` on the scrolling container, with intensity that grows with scroll, only on edges with a control.

**Toolbars.** Few items; the excess goes into a More menu. Reduce backgrounds and tints; concentric corners. Title under 15 characters, never the app name. Back and Close with the standard symbols, no text; borderless symbols. A single `.prominent` action, on the trailing side. Items grouped in leading, center and trailing positions.
→ Compact bar: Back and Menu in one glass group, "Add images" `tint` on the right; one prominent action per screen.

**A tab bar is not a toolbar.** The floating "tab" bar switches between app sections; the mogi has no sections, and the controls act on a single mogi.
→ Floating toolbar with the same glass.

**Sheets.** One bounded task, one sheet at a time. Cancel/Close on the left, Done on the right, Back when there are pages; never all three. Medium and large detents, with a grabber; fullscreen for complex flows. Per WWDC25, the partial sheet is glass inset from the edges and becomes opaque and anchored at full height. Dragging down from any point closes it; with scrolled content, the drag first scrolls back.
→ Page stack instead of sheet over sheet; fixed height across pages; Menu as a medium sheet in glass; large sheets opaque.

**Layout.** Reading order by importance. Alignment eases reading; indentation only signals hierarchy. Group, and reveal the rest progressively. Separate controls from content with glass and scroll edge, not with a solid background. Size classes and Dynamic Type.
→ One margin per level, rows with a fixed leading column, cards on a single level; compact and regular classes.

**Live Activities.** A short event, with a start and an end, shown in its essentials at a glance; a tap opens the detail.
→ The mogi screen's **glance**: each layer shows only what the previous one lacks, and the header action is a status you can tap.

**Targets and motion.** Minimum target 44 × 44 pt; the target can extend into the gaps between controls, beyond the drawing. On macOS, with a pointer, the default is 28 × 28 pt and the minimum 20 × 20 pt. Dismissing is faster than presenting.
→ An action has the same size wherever it appears; 200 ms exits, shorter than entrances. The one exception is the title bar band under Window Controls Overlay, where controls follow the macOS size to centre on the window controls ([desktop chrome](../contracts/design-system.md#desktop-chrome)).

**Search.** On iPhone, in a floating bar at the bottom, within thumb reach and above the keyboard; on iPad and Mac, at the top.
→ Sheet `search` slot: at the bottom on compact, under the title on regular.

**Navigation.** A screen over the list forms a stack; the chevron (‹) signals that the left-edge gesture goes back. A home icon is not standard on iPhone.
→ Back (‹) returns to the list; each mogi in history (`?mogi=`), sheets outside it.

**Sidebar.** macOS 27 replaced macOS 26's floating sidebar with margins by one that reaches the window edge. The lesson is to have a single surface, in the material of everything else: a translucent gray is neither control glass nor an opaque content surface, and a hard outline clashes with chrome floating over a plain background.
→ One surface for navigation in both presentations; the docked one reaches the edge.

## What the web can do

| Effect | Web | Decision |
| --- | --- | --- |
| Blur and saturation behind the control | `backdrop-filter` works in every browser, including Safari on iPhone | `glass` and `glass-tint`, after the macOS Notes toolbar capsules: a fill offset from the background (background at 72% in light; in dark, 8% foreground over the background at 55%; primary at 85%), `blur(24px) saturate(180%)`, a 0.5px top specular line and 0.5px hairline, and almost no shadow (`0 1px 3px` at 6% in light, 10% on `tint`, none in dark). Controls grouped in one capsule drop their own fill, shadow and blur |
| Refraction (a lens that distorts the background) | An SVG filter in `backdrop-filter` renders only in Chromium (WebKit #313914) | Out; the audience is on iPhone |
| Soft scroll edge | `backdrop-filter` always ends at a straight boundary, even with layered masks: the "line" that gives fake glass away | Mask on the content itself (`edge-mask`) |
| Reduce transparency | `prefers-reduced-transparency` | Opaque surfaces |
| Reduce motion | `prefers-reduced-motion` | Fades only |

`edge-mask` settings validated in the prototype: intensity 0 at the top and full after ~32 px of scroll; content stays visible (at most 75% fade); a 7rem ramp on a smooth curve. A short ramp and a full fade looked like a hard line.

## First paint

Layout decided in JavaScript (`matchMedia`, width measurement) paints the phone arrangement and then swaps; a theme applied in a `useEffect` paints light before dark. Hence: arrangement in CSS (media queries for the frame, container queries for the column's content), the theme script in `<head>` before paint, and `color-scheme` on `:root`. Script only chooses the surface when it opens.

## Validated on device

Real iPhone, in Safari (28/10/2026) and in the installed app (29/10/2026): the edge gesture goes back from the mogi to the list, and the sheet closes when dragged from any position; so the app uses the system gestures. Pending physical verification: pasting the copied image in Safari, and the table's diagonal drag inside the sheet.
