// Streams the body and stops at `limit` bytes, so an oversized (or endless)
// upstream response is cut off instead of being buffered whole in memory.
export async function readLimited(upstream: Response, limit: number) {
  const tooLarge = () => Error('The response was too large.');
  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await upstream.body?.cancel();
    throw tooLarge();
  }
  if (!upstream.body) return new Uint8Array(0);
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
