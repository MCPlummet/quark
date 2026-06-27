// Settings dialog — a thin host over the tab registry.
//
// The dialog owns only the chrome (header, tab bar, content area, footer) and
// the active-tab plumbing. Each tab's UI lives in its own module under
// settings/tabs/ and is registered in settings/registry.ts; the host iterates
// SETTINGS_TABS to build the tab buttons, switch content, and cycle with Tab —
// so adding/removing a tab is a one-line registry change with no switchyard to
// touch here.

import { isMobile } from "../app/mobile.js";
import { DialogBase } from "./DialogBase.js";
import { makeControls } from "./settings/controls.js";
import type { SettingsControls } from "./settings/controls.js";
import type { SettingsTab } from "./settings/types.js";
import { SETTINGS_TABS, visibleTabs } from "./settings/registry.js";
import packageJson from "../../package.json";

export class SettingsDialog extends DialogBase {
  private _panelEl: HTMLElement;
  private _contentEl: HTMLElement;
  private readonly _controls: SettingsControls = makeControls();
  private readonly _tabs: SettingsTab[];
  private _activeId: string;
  private _tabEls: Map<string, HTMLElement> = new Map();

  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Settings" });
    this._panelEl = this.content;

    // Compute the visible tab set once; the tab bar, content switch, and Tab
    // cycling all iterate the same list.
    this._tabs = visibleTabs(SETTINGS_TABS, isMobile());
    this._activeId = this._tabs[0].id;

    // Header
    this.buildHeader("── settings ──", "Close settings");

    // Tab bar — one button per registered (visible) tab.
    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");

    for (const tab of this._tabs) {
      this._tabEls.set(tab.id, this._makeTab(tab.label, tab.id, tabs));
    }

    this._panelEl.appendChild(tabs);

    // Content area
    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._panelEl.appendChild(this._contentEl);

    // Footer
    const footer = document.createElement("div");
    footer.className = "settings-dialog__footer";
    footer.setAttribute("aria-hidden", "true");

    const footerHint = document.createElement("span");
    footerHint.textContent = "Tab switch section · Esc close";
    footer.appendChild(footerHint);

    const footerVersion = document.createElement("span");
    footerVersion.className = "settings-dialog__footer-version";
    footerVersion.textContent = `v${packageJson.version}`;
    footer.appendChild(footerVersion);

    this._panelEl.appendChild(footer);
  }

  show(): void {
    this.reveal();
    this._switchTab(this._tabs[0].id);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _makeTab(label: string, id: string, parent: HTMLElement): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-dialog__tab";
    btn.textContent = label;
    btn.setAttribute("role", "tab");
    btn.addEventListener("click", () => this._switchTab(id));
    parent.appendChild(btn);
    return btn;
  }

  private _switchTab(id: string): void {
    this._activeId = id;

    for (const [key, el] of this._tabEls) {
      if (key === id) {
        el.classList.add("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "true");
      } else {
        el.classList.remove("settings-dialog__tab--active");
        el.setAttribute("aria-selected", "false");
      }
    }

    this._contentEl.innerHTML = "";

    const tab = this._tabs.find((t) => t.id === id);
    if (!tab) return;
    void tab.build({
      content: this._contentEl,
      controls: this._controls,
      isMobile: isMobile(),
      close: () => this.hide(),
      dispatch: (a) => document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: a } })),
    });
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    if (e.key === "Tab") {
      e.preventDefault();
      const idx = this._tabs.findIndex((t) => t.id === this._activeId);
      this._switchTab(this._tabs[(idx + 1) % this._tabs.length].id);
      return;
    }

    if (e.ctrlKey && e.key === "[") {
      e.preventDefault();
      this.hide();
      return;
    }

    this.routeKey(e);
  }
}
