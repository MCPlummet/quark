// Settings dialog — a thin host over the tab registry.
//
// The dialog owns only the chrome (header, tab rail, content area, footer) and
// the active-tab plumbing. Each tab's UI lives in its own module under
// settings/tabs/ and is registered in settings/registry.ts; the host iterates
// SETTINGS_TABS to build the tab buttons, switch content, and cycle with Tab —
// so adding/removing a tab is a one-line registry change with no switchyard to
// touch here.
//
// Layout: a vertical tab rail sits on the left of a `__body` flex row, with the
// active tab's content scrolling on the right. On mobile the two collapse into a
// single pane that shows either the tab list or one tab's content at a time
// (the `--detail` modifier on the panel toggles between them), with a back
// button in the header to return to the list.
//
// The dialog is a long-lived singleton (built once at app start), so the tab
// rail is (re)built on every show() against the current viewport — that keeps
// the mobile/desktop split and the mobile-hidden tab set correct even if the
// window crossed the breakpoint since it was last opened.

import { isMobile } from "../app/mobile.js";
import { DialogBase } from "./DialogBase.js";
import { makeControls } from "./settings/controls.js";
import type { SettingsControls } from "./settings/controls.js";
import type { SettingsTab } from "./settings/types.js";
import { SETTINGS_TABS, visibleTabs } from "./settings/registry.js";
import packageJson from "../../package.json";

const TITLE = "── settings ──";
const DETAIL_CLASS = "settings-dialog__panel--detail";

export class SettingsDialog extends DialogBase {
  private _panelEl: HTMLElement;
  private _bodyEl: HTMLElement;
  private _contentEl!: HTMLElement;
  private _backBtn: HTMLButtonElement;
  private readonly _controls: SettingsControls = makeControls();
  private _tabs: SettingsTab[] = [];
  private _mobile = false;
  private _activeId = "";
  private _tabEls: Map<string, HTMLElement> = new Map();

  constructor() {
    super({ prefix: "settings-dialog", ariaLabel: "Settings" });
    this._panelEl = this.content;

    // Header — a back button (mobile detail view only) precedes the title.
    this.buildHeader(TITLE, "Close settings");
    this._backBtn = document.createElement("button");
    this._backBtn.type = "button";
    this._backBtn.className = "settings-dialog__back";
    this._backBtn.textContent = "[‹ back]";
    this._backBtn.setAttribute("aria-label", "Back to settings list");
    this._backBtn.tabIndex = -1;
    this._backBtn.addEventListener("click", () => this._showList());
    this.header?.insertBefore(this._backBtn, this.header.firstChild);

    // Body — the tab rail and content area live side by side (desktop) or one
    // at a time (mobile). Populated per-open by _buildRail().
    this._bodyEl = document.createElement("div");
    this._bodyEl.className = "settings-dialog__body";
    this._panelEl.appendChild(this._bodyEl);

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
    this._mobile = isMobile();
    this._tabs = visibleTabs(SETTINGS_TABS, this._mobile);
    this._activeId = this._tabs[0].id;
    this._buildRail();
    this._showList(); // always start on the list (resets the detail modifier/title)

    this.reveal();
    // Desktop opens straight into the first tab; mobile stays on the tab list
    // and only loads a tab's content when the user picks one.
    if (!this._mobile) this._switchTab(this._tabs[0].id);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** (Re)build the tab rail + content area for the current viewport. */
  private _buildRail(): void {
    this._bodyEl.innerHTML = "";
    this._tabEls.clear();

    const tabs = document.createElement("div");
    tabs.className = "settings-dialog__tabs";
    tabs.setAttribute("role", "tablist");
    for (const tab of this._tabs) {
      this._tabEls.set(tab.id, this._makeTab(tab.label, tab.id, tabs));
    }
    this._bodyEl.appendChild(tabs);

    this._contentEl = document.createElement("div");
    this._contentEl.className = "settings-dialog__content";
    this._bodyEl.appendChild(this._contentEl);
  }

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
      isMobile: this._mobile,
      close: () => this.hide(),
      dispatch: (a) => document.dispatchEvent(new CustomEvent("quark:action", { detail: { action: a } })),
    });

    // On mobile, switching tabs navigates from the list into that tab's pane.
    if (this._mobile) this._enterDetail(tab.label);
  }

  /** Mobile: show the tab list (the first of the two screens). Inert on desktop. */
  private _showList(): void {
    this._panelEl.classList.remove(DETAIL_CLASS);
    if (this.titleEl) this.titleEl.textContent = TITLE;
  }

  /** Mobile: show a single tab's content, with the back button and tab name. */
  private _enterDetail(label: string): void {
    this._panelEl.classList.add(DETAIL_CLASS);
    if (this.titleEl) this.titleEl.textContent = label;
  }

  // ── Keyboard handler ──────────────────────────────────────────────────────────

  protected override handleKeydown(e: KeyboardEvent): void {
    e.stopPropagation();

    // Mobile: Escape backs out of a tab to the list before closing the dialog.
    if (this._mobile && this.isEscape(e) && this._panelEl.classList.contains(DETAIL_CLASS)) {
      e.preventDefault();
      this._showList();
      return;
    }

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
