import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Unit tests for the shared link helper (src/app/links.ts). The Timeline-level
// integration lives in src/ui/Timeline.links.test.ts; here we exercise the
// helper and the global activation guard directly on a bare DOM, which is what
// proves the guard covers anchors created by *any* component — the point of
// #46 (middle click navigated the WebView because only some anchors carried a
// click handler).

vi.mock("./mobile.js", async (importActual) => {
  const actual = await importActual<typeof import("./mobile.js")>();
  return { ...actual, isMobile: vi.fn(() => false) };
});

vi.mock("../ipc/invoke.js", async (importActual) => {
  const actual = await importActual<typeof import("../ipc/invoke.js")>();
  return { ...actual, invoke: vi.fn(() => Promise.resolve(undefined)) };
});

import {
  appendLinkifiedText,
  createMessageLink,
  decorateMessageLinks,
  installLinkGuard,
  isExternalHref,
  openExternalUrl,
} from "./links.js";
import { isMobile } from "./mobile.js";
import { invoke } from "../ipc/invoke.js";

const mockIsMobile = vi.mocked(isMobile);
const mockInvoke = vi.mocked(invoke);

function openCalls(): Array<Record<string, unknown> | undefined> {
  return mockInvoke.mock.calls
    .filter((c) => c[0] === "open_external_url")
    .map((c) => c[1] as Record<string, unknown> | undefined);
}

let host: HTMLElement;

beforeEach(() => {
  mockIsMobile.mockReturnValue(false);
  mockInvoke.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  host.remove();
});

describe("isExternalHref", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com", true],
    ["HTTPS://EXAMPLE.COM", true],
    ["mailto:a@b.c", false],
    ["javascript:alert(1)", false],
    ["/relative", false],
    ["", false],
  ])("%s → %s", (href, expected) => {
    expect(isExternalHref(href as string)).toBe(expected);
  });
});

describe("openExternalUrl", () => {
  it("routes http(s) through the backend command", () => {
    openExternalUrl("https://example.com/a");
    expect(openCalls()).toEqual([{ url: "https://example.com/a" }]);
  });

  it("refuses non-http schemes", () => {
    openExternalUrl("javascript:alert(1)");
    openExternalUrl("file:///etc/passwd");
    expect(openCalls()).toEqual([]);
  });
});

describe("createMessageLink", () => {
  it("styles the anchor and defaults the label to the URL", () => {
    const a = createMessageLink("https://example.com/x");
    expect(a.classList.contains("message__link")).toBe(true);
    expect(a.textContent).toBe("https://example.com/x");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.title).toBe("https://example.com/x");
  });

  it("keeps a custom label but still points at the URL", () => {
    const a = createMessageLink("https://example.com/x", "click me");
    expect(a.textContent).toBe("click me");
    expect(a.getAttribute("href")).toBe("https://example.com/x");
  });

  it("sets target=_blank on mobile only (the double-open fix)", () => {
    expect(createMessageLink("https://example.com").hasAttribute("target")).toBe(false);
    mockIsMobile.mockReturnValue(true);
    expect(createMessageLink("https://example.com").getAttribute("target")).toBe("_blank");
  });
});

describe("decorateMessageLinks", () => {
  it("gives formatted_body anchors the same class as linkified URLs (#51)", () => {
    host.innerHTML = '<a href="https://example.com/p">some words</a>';
    decorateMessageLinks(host);
    const a = host.querySelector("a")!;
    expect(a.classList.contains("message__link")).toBe(true);
    expect(a.rel).toBe("noopener noreferrer");
  });

  it("neutralises non-http hrefs so they cannot navigate the WebView", () => {
    host.innerHTML = '<a href="javascript:alert(1)">x</a><a href="/rel">y</a>';
    decorateMessageLinks(host);
    for (const a of Array.from(host.querySelectorAll("a"))) {
      expect(a.hasAttribute("href")).toBe(false);
      expect(a.getAttribute("role")).toBe("link");
      expect(a.classList.contains("message__link")).toBe(false);
    }
  });

  it("is idempotent", () => {
    host.innerHTML = '<a href="https://example.com">x</a>';
    decorateMessageLinks(host);
    decorateMessageLinks(host);
    const a = host.querySelector("a")!;
    expect(a.className).toBe("message__link");
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(openCalls()).toEqual([{ url: "https://example.com" }]);
  });
});

describe("appendLinkifiedText", () => {
  it("splits text into text nodes and anchors", () => {
    appendLinkifiedText(host, "go to https://example.com/a then https://example.com/b ok");
    const as = Array.from(host.querySelectorAll("a"));
    expect(as.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(host.textContent).toBe("go to https://example.com/a then https://example.com/b ok");
  });

  it("leaves URL-free text alone", () => {
    appendLinkifiedText(host, "nothing to see");
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toBe("nothing to see");
  });
});

describe("global link guard (#46)", () => {
  // Anchors here are appended by hand — no Timeline involved — so a passing
  // test means the guard covers every component that renders a link.
  function anchor(href = "https://example.com/g"): HTMLAnchorElement {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = "link";
    host.appendChild(a);
    return a;
  }

  /**
   * Dispatch `type` at `target` and report whether the *guard* cancelled it.
   *
   * The guard listens on `document` in the capture phase, so a capture
   * listener on `host` always runs after it: it can read the guard's verdict
   * and then swallow the default itself, which stops jsdom from logging
   * "Not implemented: navigation" for the cases the guard deliberately lets
   * through.
   */
  function fire(target: EventTarget, type: string, init: MouseEventInit = {}): boolean {
    let preventedByGuard = false;
    const spy = (e: Event): void => {
      preventedByGuard = e.defaultPrevented;
      e.preventDefault();
    };
    host.addEventListener(type, spy, true);
    try {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
    } finally {
      host.removeEventListener(type, spy, true);
    }
    return preventedByGuard;
  }

  it("installLinkGuard is idempotent (no double-open on repeat calls)", () => {
    installLinkGuard();
    installLinkGuard();
    fire(anchor(), "click");
    expect(openCalls()).toEqual([{ url: "https://example.com/g" }]);
  });

  it("intercepts left click on an anchor no component wired up", () => {
    expect(fire(anchor(), "click", { button: 0 })).toBe(true);
    expect(openCalls()).toEqual([{ url: "https://example.com/g" }]);
  });

  it("intercepts middle click (auxclick button 1)", () => {
    expect(fire(anchor(), "auxclick", { button: 1 })).toBe(true);
    expect(openCalls()).toEqual([{ url: "https://example.com/g" }]);
  });

  it("cancels middle mousedown without opening anything", () => {
    expect(fire(anchor(), "mousedown", { button: 1 })).toBe(true);
    expect(openCalls()).toEqual([]);
  });

  it("ignores left mousedown so text selection and drags still work", () => {
    expect(fire(anchor(), "mousedown", { button: 0 })).toBe(false);
  });

  it("ignores anchors with a download attribute", () => {
    const a = anchor("https://example.com/file.png");
    a.setAttribute("download", "file.png");
    expect(fire(a, "click")).toBe(false);
    expect(openCalls()).toEqual([]);
  });

  it("ignores non-anchor clicks", () => {
    expect(fire(host, "click")).toBe(false);
    expect(openCalls()).toEqual([]);
  });

  it("ignores blob:/data: hrefs (media affordances keep native behaviour)", () => {
    expect(fire(anchor("blob:https://localhost/abc"), "click")).toBe(false);
    expect(openCalls()).toEqual([]);
  });

  it("does not re-open a link a component already handled", () => {
    const a = anchor();
    a.addEventListener("click", (e) => e.preventDefault());
    // Component handlers run after our capture-phase guard, so the guard is
    // still the one that opens — and it opens exactly once.
    fire(a, "click");
    expect(openCalls()).toHaveLength(1);
  });
});
