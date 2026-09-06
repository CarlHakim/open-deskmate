/** Best-effort presence must never hold up task execution or reply delivery. */
export function startTypingIndicator(send: () => Promise<unknown>, intervalMs = 4000): () => void {
  let stopped = false;
  let pending = false;
  const tick = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      await send();
    } catch {
      // Presence is optional; task and delivery errors are handled separately.
    } finally {
      pending = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
