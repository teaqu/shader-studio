# UI control conventions

The viewer, standalone shell and Shader Explorer import `styles/controls.css`.
Use its semantic tokens instead of giving each component its own control scale.
The viewer and explorer load the file through their application stylesheets;
standalone embeds those components and imports the viewer stylesheet.

## Roles and dimensions

| Role | Token | Desktop default |
| --- | --- | --- |
| Form actions, text/number inputs, selects | `--shader-studio-control-height` | 26px |
| Toolbar and compact icon actions | `--shader-studio-toolbar-height` | 24px |
| Pass, channel-category and docking tabs | `--shader-studio-tab-height` | 35px |
| Control radius | `--shader-studio-control-radius` | 4px |
| Control text | `--shader-studio-font-size` | VS Code font size, falling back to 13px |
| Control font | `--shader-studio-font-family` | VS Code font family |
| Secondary labels | `--shader-studio-label-size` | 12px |

These are application defaults, not a claim that every native VS Code control
has the same dimensions. Keep distinctions between control roles deliberate.
Do not shrink toolbar text or targets merely because its panel is narrow; use
the existing overflow/collapse behaviour. Standalone touch navigation retains
its 44px targets and readable input text.

Set `box-sizing: border-box`. Use the shared padding and line-height tokens so
padding does not increase the intended control height. Composite controls such
as export width/height and frame-rate inputs own one outer border: their inner
inputs have no padding and use the control line height instead of another full
control height.

Native checkbox/radio/range inputs, colour swatches, editor internals, shader
canvases, thumbnails, charts and resize/drag handles are not rectangular form
actions. Preserve their meaningful dimensions. Icon glyphs and headings can
have a different type size; do not treat a large close glyph as a larger text
button.

## Theme ownership

Use `--vscode-*` tokens for the corresponding foreground/background pair:

- Primary actions: `button-background`, `button-foreground`,
  `button-hoverBackground`.
- Secondary actions: `button-secondaryBackground`,
  `button-secondaryForeground`, `button-secondaryHoverBackground`.
- Text fields: `input-background`, `input-foreground`, `input-border`.
- Dropdowns: `dropdown-background`, `dropdown-foreground`, `dropdown-border`.
- File/pass tabs: the `tab-*` and `editorGroupHeader-tabsBackground` tokens.
- Menu rows: `menu-background`, `menu-foreground`, `menu-selectionBackground`,
  `menu-selectionForeground`.
- Selected options: the shared `--shader-studio-selected-*` aliases, which
  prefer VS Code's `inputOption-active*` tokens.
- Focus and disabled controls: `focusBorder`, `disabledForeground`.

Resolve aliases on `body` as well as `:root`: VS Code injects its host properties
on the body. Browser theme profiles supply fallback palette values without
replacing the host's body-level properties. Do not use a literal white label on
an arbitrary focus colour, or a primary button fill as a generic panel surface.

Component rules still own layout, wrapping, truncation and interaction states.
The shared layer does not flatten code syntax, shader output or chart series
into UI colours. It does not change file/pass navigation or shader locking.

## Layout and wrapping

Keep file selection actions beside the field they affect. At narrow widths,
move the label above that row before putting Select on a separate line.
Supporting text gets its own row. Long filenames wrap inside their picker;
Open editor remains alongside it. Resolution presets wrap inside their group,
leaving Reset aligned with the start of that group.

Use flexible columns for paired media settings. When two fields cannot fit,
stack complete labelled fields rather than overflowing or squeezing controls.

The channel dialog also imports `channelPages.css` for its shared section
spacing and responsive layout. Keep media thumbnails in the asset browser;
Misc retains its large preview cards; live audio uses compact choices.
Group source, sampling, playback and preview controls under consistent headings.
All applicable channel tabs use the shared `sampling-fields`, `sampling-field`
and `sampling-options` classes: labels above equal dropdowns, Filter then Wrap,
with checkboxes underneath. Stack complete fields at narrow widths.
The dialog keeps its dimensions while switching categories and scrolls its body
for longer content. Layout changes must preserve the existing source-selection
commands, capture availability and save behaviour.

## Keyboard focus

Keep a visible `:focus-visible` outline using `--vscode-focusBorder`, including
on active, disabled-adjacent and portalled controls. A local `all: unset` or
`outline: none` can override the global focus rule; restore the focus style in
that component's scope. Selection alone is not a keyboard focus indicator.

## Verification

`ui/src/test/e2e/ControlConsistency.e2e.test.ts` mounts actual viewer and
standalone components in Chromium and checks matching geometry, host fonts,
light/dark colours, keyboard focus and narrow toolbar sizes. Existing
`ClearControlsTheme` tests exercise native controls and VS Code high-contrast
host classes. The standalone Config selection test checks that selected
options retain their highlight on hover.

Run browser component tests from `ui/`:

```sh
npx vitest run --browser.headless --config vitest.browser.config.mts \
  src/test/e2e/ControlConsistency.e2e.test.ts \
  src/test/e2e/ClearControlsTheme.e2e.test.ts
```

Run affected component tests, the full UI type check, the standalone and
explorer checks, lint, and a standalone build before changing shared tokens.
Review both light/dark appearances, portalled dialogs/menus and mobile controls
when adding new control families.
