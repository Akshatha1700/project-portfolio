/* =====================================================================
   site.js — progressive enhancement only.

   Nothing here is required to read the site. Every page is complete and
   navigable with JavaScript disabled; each function below fails silently
   and leaves the un-enhanced (fully usable) markup in place.
   ===================================================================== */
(function () {
  "use strict";

  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function onReady(fn) {
    if (document.readyState !== "loading") {
      fn();
    } else {
      document.addEventListener("DOMContentLoaded", fn);
    }
  }

  /* -------------------------------------------------------------------
     1. Mobile navigation.
     The drawer is a plain link list by default; this only adds the
     `data-open` switch and the aria wiring.
     ------------------------------------------------------------------- */
  function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!toggle || !nav) return;

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      nav.setAttribute("data-open", open ? "true" : "false");
    }

    setOpen(false);

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setOpen(false);
    });

    // Collapsing back to the desktop layout must not leave a stale drawer
    // state behind for when the viewport shrinks again.
    if (window.matchMedia) {
      var wide = window.matchMedia("(min-width: 60.0625rem)");
      var onChange = function (event) {
        if (event.matches) setOpen(false);
      };
      if (wide.addEventListener) wide.addEventListener("change", onChange);
      else if (wide.addListener) wide.addListener(onChange);
    }
  }

  /* -------------------------------------------------------------------
     2. Reveal on scroll.
     `reveal-ready` is added by this script, so if it never runs the
     content is simply visible from the start.
     ------------------------------------------------------------------- */
  function initReveal() {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    if (prefersReducedMotion || !("IntersectionObserver" in window)) return;

    document.documentElement.classList.add("reveal-ready");

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );

    targets.forEach(function (target, index) {
      target.style.setProperty("--reveal-delay", (index % 4) * 60 + "ms");
      observer.observe(target);
    });

    // Anything still hidden after load (off-screen never-scrolled content
    // in a very short document) gets shown rather than left invisible.
    window.addEventListener("load", function () {
      targets.forEach(function (target) {
        var box = target.getBoundingClientRect();
        if (box.top < window.innerHeight) target.classList.add("is-visible");
      });
    });
  }

  /* -------------------------------------------------------------------
     3. Chart draw-in.
     The SVG ships fully drawn; this measures the path, hides it, and
     animates the stroke back in. If it throws, the chart is already
     correct on the page.
     ------------------------------------------------------------------- */
  function initCharts() {
    var charts = document.querySelectorAll("[data-chart-animate]");
    if (!charts.length || prefersReducedMotion) return;

    charts.forEach(function (chart) {
      var lines = chart.querySelectorAll(".chart__line, .chart__area");
      var points = chart.querySelectorAll(".chart__point, .chart__bar");

      lines.forEach(function (line) {
        var length = 0;
        try {
          length = line.getTotalLength();
        } catch (error) {
          return; // not a geometry element: leave it alone
        }
        if (!length) return;

        line.style.strokeDasharray = length + " " + length;
        line.style.strokeDashoffset = length;
        line.style.transition =
          "stroke-dashoffset 1400ms cubic-bezier(.22,.61,.36,1)";

        window.requestAnimationFrame(function () {
          line.style.strokeDashoffset = "0";
        });
      });

      points.forEach(function (point, index) {
        point.style.opacity = "0";
        point.style.transition = "opacity 420ms ease-out " + (200 + index * 70) + "ms";
        window.requestAnimationFrame(function () {
          point.style.opacity = "1";
        });
      });

      // If the animation is interrupted, make sure nothing stays hidden.
      window.setTimeout(function () {
        lines.forEach(function (line) {
          line.style.strokeDashoffset = "0";
        });
        points.forEach(function (point) {
          point.style.opacity = "1";
        });
      }, 2400);
    });
  }

  /* -------------------------------------------------------------------
     4. Lightbox for plates.
     The markup is a real link to the image, so this only intercepts when
     it can build a working overlay.
     ------------------------------------------------------------------- */
  function initLightbox() {
    var triggers = document.querySelectorAll("[data-lightbox]");
    if (!triggers.length) return;

    var overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Enlarged plate");
    overlay.innerHTML =
      '<button class="lightbox__close" type="button" aria-label="Close">' +
      "\u00d7</button>" +
      '<figure class="lightbox__figure">' +
      '<img class="lightbox__img" alt="">' +
      '<figcaption class="lightbox__caption"></figcaption>' +
      "</figure>";
    document.body.appendChild(overlay);

    var image = overlay.querySelector(".lightbox__img");
    var caption = overlay.querySelector(".lightbox__caption");
    var closeButton = overlay.querySelector(".lightbox__close");
    var lastFocused = null;

    function close() {
      overlay.classList.remove("is-open");
      document.body.style.overflow = "";
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function open(trigger) {
      var img = trigger.querySelector("img");
      image.src = trigger.getAttribute("href");
      image.alt = img ? img.alt : "";
      caption.textContent = img ? img.alt : "";
      overlay.classList.add("is-open");
      document.body.style.overflow = "hidden";
      lastFocused = trigger;
      closeButton.focus();
    }

    triggers.forEach(function (trigger) {
      trigger.addEventListener("click", function (event) {
        event.preventDefault();
        open(trigger);
      });
    });

    closeButton.addEventListener("click", close);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay.classList.contains("is-open")) {
        close();
      }
    });
  }

  /* -------------------------------------------------------------------
     5. Copy-to-clipboard for the contact address.
     The address is already a mailto link, so this is a convenience only.
     ------------------------------------------------------------------- */
  function initCopy() {
    var buttons = document.querySelectorAll("[data-copy]");
    if (!buttons.length) return;

    buttons.forEach(function (button) {
      var status = document.getElementById(button.getAttribute("aria-describedby"));
      var value = button.getAttribute("data-copy");

      button.addEventListener("click", function () {
        function done(ok) {
          if (!status) return;
          status.textContent = ok ? "Copied" : "Select and copy manually";
          window.setTimeout(function () {
            status.textContent = "";
          }, 2600);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(
            function () {
              done(true);
            },
            function () {
              done(false);
            }
          );
          return;
        }

        // Fallback for browsers without the async clipboard API.
        try {
          var field = document.createElement("textarea");
          field.value = value;
          field.setAttribute("readonly", "");
          field.style.position = "fixed";
          field.style.opacity = "0";
          document.body.appendChild(field);
          field.select();
          done(document.execCommand("copy"));
          document.body.removeChild(field);
        } catch (error) {
          done(false);
        }
      });
    });
  }

  /* -------------------------------------------------------------------
     6. Year stamp in the footer.
     ------------------------------------------------------------------- */
  function initYear() {
    var nodes = document.querySelectorAll("[data-year]");
    if (!nodes.length) return;
    var year = String(new Date().getFullYear());
    nodes.forEach(function (node) {
      node.textContent = year;
    });
  }

  onReady(function () {
    // Each one is isolated: a failure in one enhancement must not stop
    // the others from running.
    [initNav, initReveal, initCharts, initLightbox, initCopy, initYear].forEach(
      function (init) {
        try {
          init();
        } catch (error) {
          if (window.console && window.console.warn) {
            window.console.warn("enhancement skipped:", error);
          }
        }
      }
    );
  });
})();
