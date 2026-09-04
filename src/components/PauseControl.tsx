import { getPauseState } from "@/lib/system-state";
import { pauseAction, resumeAction } from "@/app/actions";

/** Global pause switch shown in the sidebar. Server component + server action. */
export function PauseControl() {
  const state = getPauseState();
  if (state.paused) {
    return (
      <form action={resumeAction} className="space-y-2">
        <div className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">
          Sistema pausado{state.reason ? ` — ${state.reason}` : ""}
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-[var(--ok)] px-3 py-2 text-sm font-semibold text-black hover:opacity-90"
        >
          Retomar operação
        </button>
      </form>
    );
  }
  return (
    <form action={pauseAction}>
      <input type="hidden" name="reason" value="operator_manual_pause" />
      <button
        type="submit"
        className="w-full rounded-lg bg-[var(--danger)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
      >
        Pausar tudo
      </button>
    </form>
  );
}
