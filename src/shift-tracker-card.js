const CARD_VERSION = "1.0.0";
const DEFAULT_CONFIG = {
  entity: "calendar.arlos_schedule",
  name: "Shift Tracker",
  show_countdown: true,
  show_current: true,
  call_center_mode: false,
};

const ACTIVITY_COLORS = {
  shift: "var(--primary-color)",
  break: "var(--success-color, #43a047)",
  lunch: "var(--warning-color, #f9a825)",
  admin: "var(--info-color, #039be5)",
  meeting: "var(--accent-color)",
  coaching: "#9c72cf",
  other: "var(--secondary-text-color)",
};

function classifyEvent(summary) {
  const title = String(summary || "").trim().toLowerCase();
  if (title === "shift") return "shift";
  if (/^break(?:\s*#?\s*\d+)?$/.test(title)) return "break";
  if (title === "lunch") return "lunch";
  if (title === "admin time") return "admin";
  if (title === "meeting") return "meeting";
  if (title === "coaching") return "coaching";
  return "other";
}

function eventTime(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + "T00:00:00");
  const normalized = typeof value === "string" ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function durationUntil(target, now) {
  const minutes = Math.max(0, Math.ceil((target - now) / 60000));
  if (minutes < 1) return "Less than a minute";
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours && remaining) return `${hours}h ${remaining}m`;
  if (hours) return `${hours}h`;
  return `${remaining}m`;
}

class ShiftTrackerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
    this._events = [];
    this._now = new Date();
    this._timer = null;
    this._lastFetch = 0;
    this._loading = false;
    this._error = null;
    this._unsubscribeEvents = null;
    this._rangeKey = null;
    this._subscriptionPending = false;
  }

  setConfig(config) {
    if (!config || !config.entity) {
      throw new Error("Please select a calendar entity in the Shift Tracker card configuration.");
    }
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._render();
    this._fetchEvents(true);
  }

  set hass(hass) {
    this._hass = hass;
    if (this._connected) this._subscribeEvents();
  }

  connectedCallback() {
    this._connected = true;
    this._render();
    this._subscribeEvents(true);
    this._timer = window.setInterval(() => {
      this._now = new Date();
      this._render();
      this._subscribeEvents();
    }, 15000);
  }

  disconnectedCallback() {
    this._connected = false;
    if (this._timer) window.clearInterval(this._timer);
    this._unsubscribeCalendar();
  }

  getCardSize() {
    return 3;
  }

  _unsubscribeCalendar() {
    if (this._unsubscribeEvents) {
      this._unsubscribeEvents();
      this._unsubscribeEvents = null;
    }
  }

  _subscribeEvents(force = false) {
    if (!this._hass || !this._config.entity || !this._hass.connection) return;
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 2);
    const rangeKey = `${this._config.entity}|${start.toDateString()}`;
    if (!force && this._rangeKey === rangeKey && (this._unsubscribeEvents || this._subscriptionPending)) return;

    this._unsubscribeCalendar();
    this._rangeKey = rangeKey;
    this._subscriptionPending = true;
    this._loading = true;
    this._error = null;
    this._render();

    this._hass.connection.subscribeMessage(
      (message) => {
        const receivedEvents = message?.events;
        if (!Array.isArray(receivedEvents)) {
          this._error = "Home Assistant returned no calendar event list.";
          this._events = [];
        } else {
          this._events = receivedEvents.map((event) => {
            const startDate = eventTime(event.start);
            const endDate = eventTime(event.end);
            return {
              ...event,
              title: event.summary || event.message || "Untitled event",
              startDate,
              endDate,
              kind: classifyEvent(event.summary || event.message),
            };
          }).filter((event) => event.startDate && event.endDate)
            .sort((a, b) => a.startDate - b.startDate);
          this._error = null;
        }
        this._loading = false;
        this._now = new Date();
        this._render();
      },
      {
        type: "calendar/event/subscribe",
        entity_id: this._config.entity,
        start: start.toISOString(),
        end: end.toISOString(),
      }
    ).then((unsubscribe) => {
      this._subscriptionPending = false;
      this._unsubscribeEvents = unsubscribe;
    }).catch((error) => {
      this._subscriptionPending = false;
      this._loading = false;
      this._error = error?.message || "Unable to subscribe to calendar events.";
      this._render();
    });
  }

  _getViewModel() {
    const now = this._now;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const events = this._events.filter((event) =>
      event.startDate < tomorrow && event.endDate > today
    );
    const shift = events.find((event) => event.kind === "shift");
    const active = events.find((event) =>
      event.kind !== "shift" && event.startDate <= now && event.endDate > now
    );
    const upcoming = events.find((event) =>
      event.startDate > now && event.kind !== "shift"
    );
    const current = active || (shift && shift.startDate <= now && shift.endDate > now ? shift : null);

    // When a scheduled activity is in progress, show the working period
    // immediately after it as the next item, ending at the next event or shift end.
    let next = upcoming || (shift && shift.startDate > now ? shift : null);
    if (active && shift) {
      const followingEvent = events.find((event) =>
        event.kind !== "shift" && event.startDate >= active.endDate
      );
      const workingEnd = followingEvent?.startDate || shift.endDate;
      if (workingEnd > active.endDate) {
        next = {
          title: this._config.call_center_mode ? "On Queue" : "Working",
          kind: "shift",
          startDate: active.endDate,
          endDate: workingEnd,
        };
      }
    }

    const shiftFinished = shift && shift.endDate <= now;
    return { shift, current, next, shiftFinished };
  }

  _render() {
    if (!this.shadowRoot) return;
    const vm = this._getViewModel();
    const shiftText = vm.shift
      ? `${formatTime(vm.shift.startDate)} – ${formatTime(vm.shift.endDate)}`
      : "No shift scheduled";
    const workingLabel = this._config.call_center_mode ? "On Queue" : "Working";
    const nextTitle = vm.next
      ? (vm.next.kind === "shift" && vm.next.title === "Working" ? workingLabel : vm.next.title)
      : (vm.shiftFinished ? "Shift complete" : "Nothing scheduled");
    const nextTime = vm.next
      ? `${formatTime(vm.next.startDate)} – ${formatTime(vm.next.endDate)}`
      : "";
    const countdown = vm.next && this._config.show_countdown
      ? `Starts in ${durationUntil(vm.next.startDate, this._now)}`
      : "";
    const currentTitle = vm.current
      ? (vm.current.kind === "shift" ? workingLabel : vm.current.title)
      : (vm.shiftFinished ? "Shift complete" : "Not currently scheduled");
    const statusKind = vm.current?.kind || (vm.shiftFinished ? "shift" : "other");
    const color = ACTIVITY_COLORS[statusKind] || ACTIVITY_COLORS.other;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; }
        ha-card { padding: 20px; overflow:hidden; }
        .header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:22px; }
        .name { color:var(--primary-text-color); font-size:14px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
        .header-remaining { flex-shrink:0; text-align:right; }
        .header-remaining-value { margin-top:3px; color:var(--primary-text-color); font-size:20px; font-weight:700; line-height:1.2; font-variant-numeric:tabular-nums; }
        .label { color:var(--secondary-text-color); font-size:11px; font-weight:600; letter-spacing:.10em; text-transform:uppercase; }
        .shift-row { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:end; column-gap:16px; row-gap:5px; }
        .shift-time { margin-top:0; color:var(--primary-text-color); font-size:20px; font-weight:500; line-height:1.3; font-variant-numeric:tabular-nums; }
        .remaining { min-width:0; text-align:right; }
        .remaining-value { margin-top:5px; color:var(--primary-text-color); font-size:16px; font-weight:700; font-variant-numeric:tabular-nums; }
        .current { margin-top:18px; }
        .current-value { margin-top:7px; color:${color}; font-size:clamp(28px, 7vw, 38px); font-weight:700; line-height:1.12; overflow-wrap:anywhere; }
        .next { margin-top:20px; padding-top:16px; border-top:1px solid var(--divider-color); }
        .next-title { margin-top:7px; color:var(--primary-text-color); font-size:20px; font-weight:600; line-height:1.25; overflow-wrap:anywhere; }
        .next-time { margin-top:6px; color:var(--secondary-text-color); font-size:14px; font-weight:500; font-variant-numeric:tabular-nums; }
        .countdown { margin-top:5px; color:var(--secondary-text-color); font-size:13px; }
        .empty { color:var(--secondary-text-color); }
        .error { color:var(--error-color, #db4437); font-size:13px; margin-top:12px; }
        @media (max-width: 360px) {
          ha-card { padding:16px; }
          .shift-time { font-size:18px; }
        }
      </style>
      <ha-card>
        <div class="header">
          <div class="name">${this._escape(this._config.name || DEFAULT_CONFIG.name)}</div>
          <div class="header-remaining">
            <div class="label">Time Remaining</div>
            <div class="header-remaining-value">${vm.shift && vm.shift.startDate <= this._now && vm.shift.endDate > this._now ? this._escape(durationUntil(vm.shift.endDate, this._now)) : "—"}</div>
          </div>
        </div>
        <div>
          <div class="label">Today's shift</div>
          <div class="shift-time ${vm.shift ? "" : "empty"}">${this._escape(shiftText)}</div>
        </div>
        ${this._config.show_current ? `
          <div class="current">
            <div class="label">Current activity</div>
            <div class="current-value">${this._escape(currentTitle)}</div>
          </div>` : ""}
        <div class="next">
          <div class="label">Next up</div>
          <div class="next-title">${this._escape(nextTitle)}</div>
          ${nextTime ? `<div class="next-time">${this._escape(nextTime)}</div>` : ""}
          ${countdown ? `<div class="countdown">${this._escape(countdown)}</div>` : ""}
        ${this._error ? `<div class="error">${this._escape(this._error)}</div>` : ""}
      </ha-card>`;
  }

  _escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }

  static getConfigElement() {
    return document.createElement("shift-tracker-card-editor");
  }

  static getStubConfig() {
    return { entity: DEFAULT_CONFIG.entity, name: DEFAULT_CONFIG.name };
  }
}

class ShiftTrackerCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._config || !this._hass) return;
    this.innerHTML = `
      <style>
        .editor { display:grid; gap:14px; }
        .field { display:grid; gap:6px; }
        label { color:var(--primary-text-color); font-size:14px; }
        input { box-sizing:border-box; width:100%; padding:10px; border:1px solid var(--divider-color); border-radius:6px; background:var(--card-background-color); color:var(--primary-text-color); font:inherit; }
        .toggle { display:flex; align-items:center; gap:10px; }
      </style>
      <div class="editor">
        <div class="field">
          <label for="entity">Calendar</label>
          <ha-entity-picker id="entity" label="Calendar" allow-custom-entity
            include-domains='["calendar"]' hide-clearable></ha-entity-picker>
        </div>
        <div class="field">
          <label for="name">Card title</label>
          <input id="name" type="text" value="${this._escape(this._config.name)}">
        </div>
        <label class="toggle"><input id="countdown" type="checkbox" ${this._config.show_countdown ? "checked" : ""}> Show countdown</label>
        <label class="toggle"><input id="current" type="checkbox" ${this._config.show_current ? "checked" : ""}> Show current activity</label>
        <label class="toggle"><input id="call-center" type="checkbox" ${this._config.call_center_mode ? "checked" : ""}> Call center mode (show “On Queue” instead of “Working”)</label>
      </div>`;
    const picker = this.querySelector("#entity");
    picker.hass = this._hass;
    picker.value = this._config.entity;
    picker.addEventListener("value-changed", (event) => {
      this._config = { ...this._config, entity: event.detail.value };
      this._fireConfigChanged();
    });
    this.querySelector("#name").addEventListener("change", (event) => {
      this._config = { ...this._config, name: event.target.value };
      this._fireConfigChanged();
    });
    this.querySelector("#countdown").addEventListener("change", (event) => {
      this._config = { ...this._config, show_countdown: event.target.checked };
      this._fireConfigChanged();
    });
    this.querySelector("#current").addEventListener("change", (event) => {
      this._config = { ...this._config, show_current: event.target.checked };
      this._fireConfigChanged();
    });
    this.querySelector("#call-center").addEventListener("change", (event) => {
      this._config = { ...this._config, call_center_mode: event.target.checked };
      this._fireConfigChanged();
    });
  }

  _fireConfigChanged() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config }, bubbles: true, composed: true
    }));
  }

  _escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[char]);
  }
}

if (!customElements.get("shift-tracker-card")) {
  customElements.define("shift-tracker-card", ShiftTrackerCard);
}
if (!customElements.get("shift-tracker-card-editor")) {
  customElements.define("shift-tracker-card-editor", ShiftTrackerCardEditor);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "shift-tracker-card",
  name: "Shift Tracker Card",
  description: "Tracks shift hours, breaks, lunch, and other calendar activities.",
  preview: true,
});

console.info(
  `%c SHIFT-TRACKER-CARD %c v${CARD_VERSION} `,
  "color:white;background:#167c80;font-weight:700;",
  "color:#167c80;background:white;font-weight:700;"
);
