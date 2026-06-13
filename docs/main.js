/* Landing-page progressive enhancement. Two independent pieces:
   1. Relabel the download button for the visitor's OS.
   2. Lazy-launch the live demo (the real frontend in ?debug mock mode).
   Both degrade gracefully with JS off: the download button points at the
   latest release, and the demo "open in new tab" link still works. */
(function () {
  "use strict";

  /* ---------- 1. OS-aware download label ---------- */
  (function () {
    var label = document.getElementById("download-label");
    if (!label) return;

    function detectOS() {
      var d = navigator.userAgentData;
      var p = ((d && d.platform) || navigator.platform || "").toLowerCase();
      var ua = (navigator.userAgent || "").toLowerCase();
      if (/android/.test(ua)) return "Android";
      if (/iphone|ipad|ipod/.test(ua) || (p === "macintel" && navigator.maxTouchPoints > 1)) return "iOS";
      if (/mac/.test(p) || /mac os x/.test(ua)) return "macOS";
      if (/win/.test(p) || /windows/.test(ua)) return "Windows";
      if (/linux/.test(p) || /linux|x11|ubuntu|fedora|debian/.test(ua)) return "Linux";
      return null;
    }

    var os = detectOS();
    if (os === "iOS" || os === "Android") {
      label.textContent = "Get Quark (mobile is experimental)";
    } else if (os) {
      label.textContent = "Download for " + os;
    }
  })();

  /* ---------- 2. Lazy live demo ---------- */
  (function () {
    var stage = document.getElementById("demo-stage");
    var launch = document.getElementById("demo-launch");
    if (!stage || !launch) return;

    // The app flips to its mobile drawer at <=768px (window.innerWidth inside
    // the iframe). Render it at a fixed desktop logical size and scale to fit,
    // so the 3-pane layout always shows. Below INLINE_MIN the scaled result is
    // too small to be usable, so we open the demo full-screen in a new tab.
    var LOGICAL_W = 1180;
    var LOGICAL_H = 760;
    var INLINE_MIN = 600;
    var src = stage.getAttribute("data-src") || "demo/?debug";
    var iframe = null;

    function fit() {
      if (!iframe) return;
      var s = stage.clientWidth / LOGICAL_W;
      iframe.style.transform = "scale(" + s + ")";
      stage.style.height = LOGICAL_H * s + "px";
    }

    function launchDemo() {
      if (iframe) return;
      if (stage.clientWidth < INLINE_MIN) {
        window.open(src, "_blank", "noopener");
        return;
      }
      stage.classList.add("demo-live", "demo-loading");
      iframe = document.createElement("iframe");
      iframe.className = "demo-iframe";
      iframe.title = "Quark live demo";
      iframe.setAttribute("loading", "lazy");
      iframe.width = LOGICAL_W;
      iframe.height = LOGICAL_H;
      iframe.allow = "clipboard-write";
      iframe.addEventListener("load", function () {
        stage.classList.remove("demo-loading");
      });
      iframe.src = src;
      stage.appendChild(iframe);
      fit();
    }

    launch.addEventListener("click", launchDemo);

    var raf = 0;
    window.addEventListener("resize", function () {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
  })();
})();
