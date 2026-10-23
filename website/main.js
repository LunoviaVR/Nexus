// Nexus landing page: latest release, nav, hero tilt, counters, tour tabs, reveal on scroll.
(() => {
  const LATEST = "https://api.gxthgirls.tech/nexus/releases/latest";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  /* Latest release: Nexus's own update server first, the GitHub release as the backup.
     Points every Download at the installer and fills in the version and date; the static links stay if both fail. */
  const applyRelease = ({ version, url, published }) => {
    if (url) {
      document.querySelectorAll("[data-download]").forEach((a) => (a.href = url));
      document.querySelectorAll("[data-asset-name]").forEach((el) => (el.textContent = decodeURIComponent(url.split("/").pop())));
    }
    if (version) {
      const v = version.replace(/^v?/, "v");
      document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = `${v} is out`));
      document.querySelectorAll("[data-version-plain]").forEach((el) => (el.textContent = v));
    }
    if (published) {
      const label = new Date(published).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      document.querySelectorAll("[data-released]").forEach((el) => (el.textContent = label));
    }
  };
  const fromGitHub = () =>
    fetch("https://api.github.com/repos/LunoviaVR/Nexus/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((release) => {
        const asset = (release.assets || []).find((a) => /_x64-setup\.exe$/i.test(a.name));
        applyRelease({ version: release.tag_name, url: asset && asset.browser_download_url, published: release.published_at });
      });
  fetch(LATEST, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(applyRelease)
    .catch(() => fromGitHub().catch(() => {}));

  /* Nav */
  const nav = document.querySelector(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 24);
  onScroll();
  addEventListener("scroll", onScroll, { passive: true });

  const menu = document.querySelector(".menu");
  const links = document.getElementById("nav-links");
  const setMenu = (open) => {
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    links.classList.toggle("open", open);
  };
  menu.addEventListener("click", () => setMenu(menu.getAttribute("aria-expanded") !== "true"));
  links.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));

  /* Hero device follows the pointer (desktop, fine pointer only) */
  const device = document.querySelector("[data-tilt]");
  const stage = document.querySelector(".hero-stage");
  if (device && !reduced && matchMedia("(pointer: fine) and (min-width: 981px)").matches) {
    let raf = 0;
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        device.classList.add("live");
        device.style.transform = `rotateY(${-8 + x * 10}deg) rotateX(${4 - y * 8}deg) translateZ(0)`;
      });
    });
    stage.addEventListener("pointerleave", () => {
      device.classList.remove("live");
      device.style.transform = "";
    });
  }

  /* Spotlight on bento tiles */
  document.querySelectorAll(".tile").forEach((tile) => {
    tile.addEventListener("pointermove", (e) => {
      const r = tile.getBoundingClientRect();
      tile.style.setProperty("--mx", `${e.clientX - r.left}px`);
      tile.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  /* Count-up */
  const countUp = (el) => {
    const target = +el.dataset.count;
    if (reduced) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 1400;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* Tour tabs */
  const tabs = [...document.querySelectorAll('.tour-tabs [role="tab"]')];
  const tourImg = document.querySelector("[data-tour-img]");
  const tourTitle = document.querySelector("[data-tour-title]");
  const selectTab = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    tourImg.src = tab.dataset.shot;
    tourImg.alt = tab.dataset.alt;
    tourTitle.textContent = tab.querySelector("b").textContent;
    tourImg.classList.remove("swap");
    void tourImg.offsetWidth;
    tourImg.classList.add("swap");
  };
  tabs.forEach((tab, i) => {
    tab.tabIndex = i ? -1 : 0;
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const next = tabs[(i + d + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
  // Warm the cache so switching is instant.
  addEventListener("load", () => tabs.forEach((t) => { const im = new Image(); im.src = t.dataset.shot; }));

  /* Reveal on scroll */
  const reveals = document.querySelectorAll(".reveal");
  const counters = document.querySelectorAll("[data-count]");
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        e.target.querySelectorAll("[data-count]").forEach(countUp);
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.1 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
    counters.forEach(countUp);
  }
})();
