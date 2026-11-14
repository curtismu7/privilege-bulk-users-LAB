// A bounded worker pool: `concurrency` calls in flight, never one-per-person in sequence and never all at once. A worker that throws
// stops the others from taking new work, and the first error is rethrown once everyone has finished their current item.
export async function runPool(items, concurrency, fn, { signal } = {}) {
  let next = 0; let stop = false; let error = null;
  const worker = async () => {
    for (;;) {
      if (stop || signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      try { await fn(items[i], i); } catch (err) { if (!error) error = err; stop = true; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(concurrency, items.length)) }, worker));
  if (error) throw error;
}
