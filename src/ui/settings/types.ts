// src/ui/settings/types.ts
import type { SettingsControls } from "./controls.js";

export interface SettingsTabContext {
  content: HTMLElement;
  controls: SettingsControls;
  isMobile: boolean;
  close(): void;
  dispatch(action: string): void;
}

export interface SettingsTab {
  id: string;
  label: string;
  /** Hide this whole tab on mobile. */
  mobileHidden?: boolean;
  build(ctx: SettingsTabContext): void | Promise<void>;
}
