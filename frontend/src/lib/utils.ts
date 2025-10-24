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

export function formatTimeAgo(timestamp: any): string {
  try {
    const now = Date.now();
    let messageTime: number;
    
    if (typeof timestamp === 'number') {
      // Handle Unix timestamps (could be in seconds or milliseconds)
      // If the number is less than a reasonable millisecond timestamp, assume it's in seconds
      messageTime = timestamp < 10000000000 ? timestamp * 1000 : timestamp;
    } else {
      messageTime = new Date(timestamp).getTime();
    }
    
    if (!messageTime || isNaN(messageTime)) return '';
    
    const diffMs = now - messageTime;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSeconds < 60) {
      return diffSeconds <= 5 ? 'just now' : `${diffSeconds}s ago`;
    } else if (diffMinutes < 60) {
      return `${diffMinutes}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      // For older messages, show the actual date
      const date = new Date(messageTime);
      return date.toLocaleDateString();
    }
  } catch {
    return '';
  }
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

/**
 * Debounce function - delays execution until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, wait);
  };
}
