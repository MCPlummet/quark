import { describe, it, expect, beforeAll, beforeEach } from "vitest";
// @ts-expect-error - no ambient declaration for Vite's ?raw suffix in this project
import BASE_CSS from "../style/base.css?raw";

/**
 * The typing indicator lives in the DOM for the whole session — App.ts builds
 * it once and `visibility: hidden` keeps its row reserved so the composer does
 * not jump when someone starts typing. `visibility` does not stop a CSS
 * animation, though: with the dots' `typingDot … infinite` on the base rule,
 * three animations ran from launch to quit, and an otherwise idle window never
 * stopped producing frames. The animation belongs to the active state only.
 */
function loadStylesheet(): void {
  const style = document.createElement("style");
  style.textContent = BASE_CSS as string;
  document.head.appendChild(style);
}

/** The same markup App.ts builds for the indicator. */
function buildIndicator(): { indicator: HTMLElement; dots: HTMLElement[] } {
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  const dotsWrap = document.createElement("span");
  dotsWrap.className = "typing-indicator__dots";
  dotsWrap.innerHTML = "<span></span><span></span><span></span>";
  indicator.appendChild(dotsWrap);
  document.body.appendChild(indicator);
  return { indicator, dots: Array.from(dotsWrap.querySelectorAll("span")) };
}

/**
 * The keyframes a dot runs, or "none". jsdom leaves the `animation` shorthand
 * unexpanded (`animationName` reads ""), so the name is the shorthand's first
 * token — which is how base.css writes it.
 */
const animationName = (el: HTMLElement): string => {
  const style = getComputedStyle(el);
  return style.animationName || style.animation.trim().split(/\s+/)[0] || "none";
};

describe("typing indicator animation", () => {
  beforeAll(loadStylesheet);
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("does not animate the dots while nobody is typing", () => {
    const { indicator, dots } = buildIndicator();
    expect(getComputedStyle(indicator).visibility).toBe("hidden");
    for (const dot of dots) expect(animationName(dot)).toBe("none");
  });

  it("animates the dots while the indicator is active", () => {
    const { indicator, dots } = buildIndicator();
    indicator.classList.add("typing-indicator--active");
    expect(getComputedStyle(indicator).visibility).toBe("visible");
    for (const dot of dots) expect(animationName(dot)).toBe("typingDot");
  });
});
