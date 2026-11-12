import { describe, it, expect, beforeAll, beforeEach } from "vitest";
// Vite's `?raw` loader; `src/vite-env.d.ts` types it.
import BASE_CSS from "./base.css?raw";

// The low-contrast outline (#45) is pure CSS: these pin what it draws, and
// what it must not draw, on the markup Timeline.ts builds for a message group.

const TREATMENTS = ["uc-name", "uc-avatar", "uc-border", "uc-any"];

function group(lowContrast: boolean): { fallback: HTMLElement; box: HTMLElement } {
  const wrapper = document.createElement("div");
  wrapper.className = "message-group-wrapper";
  wrapper.dataset.userColor = "#000000";
  wrapper.style.setProperty("--user-color", "#000000");
  if (lowContrast) wrapper.classList.add("user-color--low-contrast");
  const fallback = document.createElement("div");
  fallback.className = "message-group__avatar-fallback";
  fallback.textContent = "A";
  const box = document.createElement("div");
  box.className = "message-group";
  wrapper.append(fallback, box);
  document.body.appendChild(wrapper);
  return { fallback, box };
}

function treatments(...on: string[]): void {
  document.documentElement.classList.remove(...TREATMENTS);
  document.documentElement.classList.add(...on, "uc-any");
}

const shadow = (el: HTMLElement) => getComputedStyle(el).boxShadow;

describe("user colors — low-contrast outline", () => {
  beforeAll(() => {
    const style = document.createElement("style");
    style.textContent = BASE_CSS;
    document.head.appendChild(style);
  });
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("outlines a low-contrast letter avatar with only the name treatment on", () => {
    treatments("uc-name");
    const { fallback } = group(true);
    expect(shadow(fallback)).toContain("var(--fg)");
    expect(getComputedStyle(fallback).textShadow).toContain("var(--fg)");
  });

  it("leaves a readable letter avatar alone", () => {
    treatments("uc-name");
    const { fallback } = group(false);
    expect(shadow(fallback)).toBe("");
  });

  it("the avatar treatment's ring still wins over the letter-avatar outline", () => {
    treatments("uc-avatar");
    const { fallback } = group(true);
    expect(shadow(fallback)).toContain("var(--user-color)");
  });

  it("the box outline is no wider than the theme's frame, so borders = none draws none", () => {
    treatments("uc-border");
    const { box } = group(true);
    expect(shadow(box)).toContain("min(1px, var(--frame-width))");
  });
});
