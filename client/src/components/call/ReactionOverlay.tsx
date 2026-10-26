import type { FloatingReaction } from '../../hooks/useMeetingRoom';

/** Short-lived emoji reactions shown over the video grid. Announced politely to screen readers. */
export function ReactionOverlay({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div aria-live="polite" className="pointer-events-none absolute bottom-24 left-4 z-10 flex flex-col gap-1.5">
      {reactions.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-full bg-black/60 py-1 pl-2 pr-3 text-sm text-white">
          <span className="text-2xl" aria-hidden>
            {r.emoji}
          </span>
          <span>
            <span className="sr-only">{r.name} reacted with </span>
            {r.name}
          </span>
        </div>
      ))}
    </div>
  );
}
