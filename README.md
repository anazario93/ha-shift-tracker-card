# Shift Tracker Card

A custom Home Assistant Lovelace card that reads a calendar and displays your shift hours, the next scheduled activity, and the current activity.

## Features

- Select any Home Assistant calendar entity through the visual card editor.
- Displays the day's event named **Shift** as the shift time range.
- Recognizes **Break**, **Break #1**, **Break #2**, and other numbered breaks.
- Recognizes **Lunch**, **Admin Time**, **Meeting**, and **Coaching**.
- Shows the next scheduled activity and its time range.
- Optional countdown to the next activity.
- Optional current activity and shift-end information.
- Refreshes calendar events periodically and updates the countdown locally.

## Installation with HACS

1. Open HACS in Home Assistant.
2. Open the three-dot menu and choose **Custom repositories**.
3. Add `anazario93/ha-shift-tracker-card` as a **Dashboard** repository.
4. Install **Shift Tracker Card**.
5. Reload the browser or clear the frontend cache if necessary.

## Manual installation

1. Download `shift-tracker-card.js` from the repository.
2. Copy it to `config/www/shift-tracker-card.js`.
3. Add this resource under **Settings → Dashboards → Resources**:

   - URL: `/local/shift-tracker-card.js`
   - Resource type: **JavaScript Module**

4. Refresh the browser.

## Configuration

Add the card through the dashboard's visual editor and select a calendar entity. The default entity is `calendar.arlos_schedule`.

YAML example:

```yaml
type: custom:shift-tracker-card
entity: calendar.arlos_schedule
name: Shift Tracker
show_countdown: true
show_current: true
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `entity` | string | `calendar.arlos_schedule` | Calendar entity to read |
| `name` | string | `Shift Tracker` | Card heading |
| `show_countdown` | boolean | `true` | Show time until the next activity |
| `show_current` | boolean | `true` | Show current activity and shift end |

## Calendar event names

The card matches event summaries case-insensitively:

| Event summary | Classification |
|---|---|
| Shift | Shift |
| Break, Break #1, Break #2, etc. | Break |
| Lunch | Lunch |
| Admin Time | Admin |
| Meeting | Meeting |
| Coaching | Coaching |
| Any other event | Other |

## Development

The frontend card is a standalone JavaScript module and does not require a custom integration or backend.

## License

MIT
