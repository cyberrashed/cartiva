import "server-only";
import { trustedRequestOrigin } from "./app-origin";

export type JsonBodyMessages = { forbidden: string; type: string; tooLarge: string; invalid: string };

/**
 * Reads a same-origin JSON request body with a hard size limit. Rejections are
 * created by `fail` so each API keeps its own error type and wording.
 */
export async function readSameOriginJson(
  request: Request,
  maxBytes: number,
  messages: JsonBodyMessages,
  fail: (status: number, message: string) => Error,
): Promise<unknown> {
  if (!trustedRequestOrigin(request)) throw fail(403, messages.forbidden);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw fail(415, messages.type);
  if (Number(request.headers.get("content-length")) > maxBytes) throw fail(413, messages.tooLarge);
  const reader = request.body?.getReader();
  if (!reader) throw fail(400, messages.invalid);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw fail(413, messages.tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw fail(400, messages.invalid); }
}
