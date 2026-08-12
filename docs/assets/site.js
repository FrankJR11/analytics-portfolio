/* ==========================================================================
   Landing page — motion layer.
   Scroll reveals, progress bar, active-section nav. Vanilla IntersectionObserver
   plus CSS transitions; every animated property is transform/opacity so it stays
   on the compositor. Fully respects prefers-reduced-motion.
   ========================================================================== */
(function () {
  "use strict";

  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- elements that reveal on scroll --- */
  var selectors = [
    ".finding",
    ".section-head",
    ".analysis-card",
    ".disclosure",
    ".project-card",
    ".tl-item",
    ".skill-grid",
    "#about p",
    ".contact-band"
  ];
  var els = [];
  selectors.forEach(function (sel) {
    Array.prototype.forEach.call(document.querySelectorAll(sel), function (el) {
      if (!el.hasAttribute("data-reveal")) el.setAttribute("data-reveal", "");
      els.push(el);
    });
  });

  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    document.documentElement.classList.add("reveal-ready");

    /* stagger siblings so a row cascades instead of popping in together */
    var seen = {};
    els.forEach(function (el) {
      var key = el.parentNode ? (el.parentNode.className || "root") : "root";
      seen[key] = (seen[key] || 0);
      el.__i = seen[key];
      seen[key]++;
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        setTimeout(function () { el.classList.add("is-in"); }, Math.min(el.__i || 0, 5) * 70);
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

    els.forEach(function (el) { io.observe(el); });
  }

  /* --- scroll progress --- */
  if (!reduce) {
    var bar = document.createElement("div");
    bar.className = "scroll-progress";
    document.body.appendChild(bar);
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var h = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.transform = "scaleX(" + (h > 0 ? Math.min(window.scrollY / h, 1) : 0) + ")";
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* --- highlight the section you're reading --- */
  var navLinks = Array.prototype.filter.call(
    document.querySelectorAll(".nav a[href^='#']"),
    function (a) { return !a.classList.contains("btn"); }
  );
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle("is-active", a.getAttribute("href") === "#" + entry.target.id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    sections.forEach(function (s) { spy.observe(s); });
  }
})();
