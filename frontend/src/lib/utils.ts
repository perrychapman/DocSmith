export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(val: any) {
  try {
    const d = new Date(val);
    if (!isNaN(d as any)) return d.toLocaleString();
  } catch {}
  return String(val ?? "");
}

export async function readSSEStream(resp: Response, onData: (data: string) => void) {
  if (!resp.ok || !resp.body) throw new Error(String(resp.status));
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trimStart();
        if (payload === "[DONE]") continue;
        // If server emits a JSON array in one line, iterate
        try {
          const parsed = JSON.parse(payload);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              onData(JSON.stringify(item));
            }
          } else {
            onData(payload);
          }
        } catch {
          onData(payload);
        }
      }
    }
  }
}
