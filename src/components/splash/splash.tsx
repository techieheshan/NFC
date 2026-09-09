/**
 * The startup splash.
 *
 * It exists to fill the blank moment a terminal already has — never to create
 * one. So: no timer, no minimum time, and no JavaScript needed to show it. The
 * markup is server-rendered with INLINE styles, so it is correct on the very
 * first paint even before the stylesheet arrives, and it is removed the instant
 * React hydrates (see `SplashDismiss`). A fast start shows a flicker at most.
 *
 * The bottom line is a diagnosis, not a version number. While the splash is up
 * it says "Connecting…"; if the app has failed to start it says so, because a
 * frozen purple screen tells staff nothing about whether to wait or to go and
 * check the wifi.
 */

/** How long the app gets to start before the splash bothers to ask why. */
const GRACE_MS = 700;
/**
 * The probe's own budget, a little longer than the server's database one so a
 * slow-but-alive database reports itself rather than timing out here as
 * "no connection". Nothing waits on this: by the time it runs, the app has
 * already failed to start.
 */
const PROBE_TIMEOUT_MS = 3500;

const PROBE = `
(function () {
  var GRACE = ${GRACE_MS}, LIMIT = ${PROBE_TIMEOUT_MS};

  /**
   * Dismissal, without waiting for React.
   *
   * \`load\` is a real signal that the page finished loading, it needs no
   * framework, and it cannot fail to fire — so the splash lives exactly as long
   * as the load does. React's own dismissal (SplashDismiss) usually beats it by
   * a frame; whichever happens first wins, and neither is a timer.
   *
   * The exception is a page whose SCRIPTS failed: the HTML arrived, so
   * \`load\` fires, but the app cannot actually start. Uncovering a dead page
   * would be a lie, so in that case the splash stays and the probe below says
   * what is wrong.
   */
  var scriptFailed = false;
  window.addEventListener("error", function (e) {
    var t = e && e.target;
    if (t && (t.tagName === "SCRIPT" || t.tagName === "LINK")) scriptFailed = true;
  }, true);

  function dismiss() {
    if (scriptFailed) return;
    var el = document.getElementById("xenon-splash");
    if (!el) return;
    el.dataset.done = "1";
    el.style.display = "none";
  }
  if (document.readyState === "complete") dismiss();
  else window.addEventListener("load", dismiss, { once: true });

  function up() {
    var el = document.getElementById("xenon-splash");
    return el && el.dataset.done !== "1";
  }
  function status(text, bad) {
    var el = document.getElementById("xenon-splash-status");
    if (!el) return;
    el.textContent = text;
    el.style.opacity = bad ? "1" : "0.75";
    el.style.fontWeight = bad ? "600" : "400";
  }
  setTimeout(function () {
    // Dismissed already: the app started, and this never touches the network.
    if (!up()) return;
    var done = false;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      if (ctrl) ctrl.abort();
      status("No connection — check the network", true);
    }, LIMIT);
    try {
      fetch("/api/health", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (body) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (!up()) return;
          if (!body) status("Server error — tell an administrator", true);
          else if (!body.database) status("Database unreachable — tell an administrator", true);
          else status("Almost there…", false);
        })
        .catch(function () {
          if (done) return;
          done = true;
          clearTimeout(timer);
          status("No connection — check the network", true);
        });
    } catch (e) {
      done = true;
      clearTimeout(timer);
      status("No connection — check the network", true);
    }
  }, GRACE);
})();
`;

export function Splash() {
  return (
    <>
      <div
        id="xenon-splash"
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          // The theme's purple, inline so it does not wait for the stylesheet.
          background: "#7c3aed",
          color: "#ffffff",
          fontFamily: "var(--font-sans), system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: "3rem",
              height: "3rem",
              borderRadius: "0.75rem",
              background: "#ffffff",
              color: "#7c3aed",
              fontSize: "1.5rem",
              fontWeight: 700,
            }}
          >
            X
          </span>
          <span style={{ fontSize: "2rem", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Xenon
          </span>
        </div>

        {/* A slim indeterminate bar — CSS only, so it animates without JS. */}
        <div
          style={{
            width: "10rem",
            height: "3px",
            borderRadius: "999px",
            background: "rgba(255,255,255,0.25)",
            overflow: "hidden",
          }}
        >
          <div id="xenon-splash-bar" style={{ width: "40%", height: "100%", background: "#ffffff" }} />
        </div>

        <p
          id="xenon-splash-status"
          style={{ margin: 0, fontSize: "0.875rem", opacity: 0.75 }}
        >
          Connecting…
        </p>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes xenon-splash-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}" +
            "#xenon-splash-bar{animation:xenon-splash-slide 1.1s ease-in-out infinite}" +
            "@media (prefers-reduced-motion:reduce){#xenon-splash-bar{animation:none;width:100%}}",
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: PROBE }} />
    </>
  );
}
