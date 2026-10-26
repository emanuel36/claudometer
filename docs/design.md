# Claudometer design

## Goal

A GNOME Shell extension that answers two questions without leaving the desktop:

- **How close am I to my Claude Code plan limits?** The 5-hour and weekly limits, always
  visible in the top bar, with the details one click away.
- **How do I use Claude Code over time?** Output per day, per project and per model, built from
  the history Claude Code already keeps on the computer.

## Principles

- **Calm.** No notifications and no alerts. One accent color, `#d97757`; no color-coded
  thresholds anywhere in the popup.
- **One look.** Every tab is built from the same few blocks (see Look) and the same screen
  states, so the popup reads as one design.
- **Local first.** The Claude Code login is only sent to `api.anthropic.com` to read the
  limits. The history never leaves the computer, and only token counts, times, models and
  project folders are read from it, never the conversations.
- **Light on the shell.** No synchronous file IO in the shell process. Reading the history is
  slow the first time, so a helper process does it and the shell only reads a small summary.
  Everything created in `enable()` is destroyed in `disable()`.
- **Targets GNOME Shell 46**, GJS with ES modules, libadwaita 1.5 for the preferences.

## Top bar

The indicator is an optional icon followed by the usage.

| Style | One limit | Both limits |
|---|---|---|
| Percentage | `42%` | `42% · 18%` (5-hour first) |
| Bar | a 26×6px bar, then the text | two 26×4px bars stacked, 5-hour on top |
| Ring | a 16px ring filling clockwise from the top | two concentric rings, 5-hour outside |

- **Limit shown:** 5-hour (default), weekly, or both.
- **Color:** white, orange, or a color that changes with usage (default) along one of three
  scales: orange tones (default), white to red, blue to red. Each scale blends smoothly through
  three stops at 0%, 50% and 100%.
- **Position:** the left, center (default) or right part of the top bar. Changing it moves the
  indicator at once.
- The text uses the top bar's own font, like the clock. While values are outdated, the indicator
  fades; before the first value it shows `…`.

The icon is a spark: 12 rounded strokes of uneven length radiating from the center, in the
accent color.

## Popup

A tab bar, the tab's content (244px wide) and a footer.

- **Tabs:** Limits, Projects, Activity, Models; each an icon over a short name. Projects,
  Activity and Models can be hidden. The popup opens on the tab used last.
- **Footer:** on the left, the state of the limits ("Updated 2 min ago", "Offline · values
  from 14:05", "Login expired · open Claude Code", "HTTP 503 · retrying"); on the right, a gear
  that opens the settings.

### Limits

A table: `LIMIT · meter · USED · LEFT`, one row per limit: `5-hour`, `Weekly`, and, when the
plan has them and the setting is on, one `<Model> weekly` row per model with its own limit.

- **Meter:** 56×8px, rounded, always the accent color.
- **Time left:** a countdown (`3d 5h`, `2h 14m`, `14m`), or the clock time of the reset (`16:34`,
  `Sun 19:20`, following the system 12/24-hour setting), in which case the header reads
  `RESETS`.
- **Outdated values** stay on screen, faded, while the footer says why.

### Projects and Models

A range switch (`Today · 7d · 30d · All`, 7d by default), then a bar split by share of the
total, then a table: color square, name, `SHARE`, `TOKENS`.

- **Projects:** the top four projects in shades of the accent color and grey, then "Other".
  Named by folder (with the parent folder when two share a name) or by path from home.
- **Models:** one row per model family (Opus, Sonnet, Haiku, Fable, Other), largest first, in
  the family colors.

### Activity

- A range switch (`7d · 30d · 6m · All`) and a header line: the range (`LAST 7 DAYS`,
  `SINCE OCT 2025`) and the total.
- Stacked bars per day (per week or month for longer ranges), split by model family, with a
  legend.
- **When you work:** a strip of 24 cells, one per hour of the day, brighter where more was
  produced.

### Screen states

When a tab has nothing to show, its content is replaced by one centered block: a dim 28px
icon, a title and one line.

| State | Tabs | Title | Line |
|---|---|---|---|
| Loading | Limits | Checking your limits | This takes a few seconds. |
| Loading | Projects, Activity, Models | Reading your activity | This takes about a minute the first time. |
| Offline | Limits | You are offline | Limits will refresh when the network is back. |
| No login | Limits | Not signed in | Sign in to Claude Code to see your limits. |
| Expired login | Limits | Login expired | Open Claude Code to renew it. |
| Service error | Limits | Limits unavailable | HTTP 503. Trying again soon. |
| Empty range | Projects, Activity, Models | No activity yet | Use Claude Code and it will show up here. |

### Look

| Block | Look |
|---|---|
| Header | 9px, weight 600, uppercase, 1px letter-spacing, `#a0a0a0` |
| Row | 10px above and below, a 1px `rgba(255,255,255,0.10)` line between rows |
| Name | 12px, `#e6e6e6` |
| Main value | 12px bold white, tabular figures |
| Secondary value | 12px `#a0a0a0`, tabular figures |

## Settings

A preferences window with four pages. Options with a fixed set of values are rows of linked
toggle buttons; on/off options are switches.

| Page | Groups and options |
|---|---|
| Top bar | Show icon; Style and Limit shown, with a live preview; Color and Scale; Position |
| Popup | Tabs shown; per-model limits (off); reset times as countdown or clock; what the charts count (output, output and input, or all including cache); the range Activity and the lists start on; project names; hidden projects |
| Data | Refresh limits every 1, 5 (default), 15, 30 or 60 minutes; how often the history is read; Claude Code folder; keep history forever (default) or for a number of days, weeks, months or years; rebuild the history; export it as CSV |
| About | Icon, name, version, project page, report a problem |

## Data

- **Limits:** the usage endpoint Claude Code itself uses, read with Claude Code's login from its
  folder (`CLAUDE_CONFIG_DIR` or `~/.claude`). The login is never renewed here, so Claude Code
  stays signed in. Refreshes back off when the service answers 429, wait while offline, and
  resume when the network or the login changes. The last values, the time of the last request
  and the backoff are saved after every request, so after a screen lock the values show at once
  and the next request comes when the interval or the backoff ends.
- **History:** a helper process reads Claude Code's transcripts incrementally, merges repeated
  messages by id, and writes hourly totals per project and model family. The shell reads only
  that summary, asynchronously. What has been read stays after Claude Code deletes old
  transcripts.

## Mockups

`docs/images/` holds one mockup per tab, drawn with made-up data, and `overview.svg`, the
README image: the four tabs in two columns that end together on a desktop background, the
shorter column topped by a magnified piece of the top bar with the indicator in its default
look. It is built from the tab mockups, so it is rebuilt whenever one of them changes.
