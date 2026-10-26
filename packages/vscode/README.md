# Claudometer

Your Claude Code plan limits in the status bar, and how you use Claude Code and Cursor over
time: per day, per project and per model. Works in VS Code, Cursor, Windsurf and VSCodium, on
Windows, macOS and Linux.

- **Status bar:** the 5-hour limit, the weekly one or both, in a color that follows the usage.
  Hover for every limit and the time left to each reset.
- **Panel:** click the status bar, or the spark in the activity bar, for four tabs:
  - **Limits:** each limit, how much is used and when it resets.
  - **Projects:** where your tokens go, with the tokens of each model under every project.
  - **Activity:** tokens per day and the hours you work.
  - **Models:** each model's share.

Needs Claude Code signed in with a Pro or Max plan for the limits. The history comes from
Claude Code, in the terminal or in the editor's Claude Code panel.

## Cursor

Turn on **Claudometer: Add Cursor Usage (All Models)** to add Cursor's agent usage, every model
it ran, to the history, split by project, and your Cursor plan's usage to the limits. Chats of
the Cursor CLI land in their project once you run **Claudometer: Note the Projects of Cursor CLI
Chats**.

## Settings

Search for "Claudometer" in the settings, or use the gear in the panel: the limit shown and its
color, the tabs, reset times as a countdown or a clock, what is counted, the ranges, project
names, hidden projects, how often things refresh and how long the history is kept.

## Privacy

Your Claude Code login is only sent to Anthropic, to read your limits. With Cursor on, Cursor's
login is only sent to cursor.com, to read your usage. Your history never leaves the computer,
and the conversations themselves are never read.

[MIT](LICENSE) · Not affiliated with or endorsed by Anthropic or Anysphere.
