/**
 * What a tap shows while the next screen is on its way.
 *
 * Without this, tapping a tile left the OLD screen sitting there, unchanged,
 * until the server finished — on a remote database that can be a second or
 * more, and a screen that does not react to a tap looks broken, so staff tap
 * again. This renders the instant the tap lands, inside the shell (header and
 * menu stay put), and is replaced the moment the real screen is ready. It adds
 * no time to anything: it only fills time that was already being spent.
 *
 * Deliberately small — a bar and a word, not the startup splash. It appears on
 * every navigation, so anything heavier would feel like an interruption.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="bg-primary/15 h-1 w-full overflow-hidden rounded-full">
        <div className="bg-primary h-full w-1/3 animate-[xenon-tap_1s_ease-in-out_infinite] rounded-full" />
      </div>
      <p className="text-muted-foreground text-sm">Loading…</p>
      <style>{`@keyframes xenon-tap{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
@media (prefers-reduced-motion:reduce){[class*="xenon-tap"]{animation:none}}`}</style>
    </div>
  );
}
