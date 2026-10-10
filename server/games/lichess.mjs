const USER_AGENT = "MoveMirror/0.5.0 (local import; no cloud)";

export function lichessHeaders() {
  return {
    Accept: "application/x-chess-pgn",
    "User-Agent": USER_AGENT,
  };
}

export async function fetchLichessGames(username, { from, to } = {}, { fetchImpl = fetch, sleep = delay, signal, attempts = 4 } = {}) {
  const query = new URLSearchParams({
    moves: "true",
    tags: "true",
    clocks: "false",
    evals: "false",
    opening: "true",
    perfType: "ultraBullet,bullet,blitz,rapid,classical,correspondence",
  });
  if (from) query.set("since", String(new Date(from).getTime()));
  if (to) query.set("until", String(new Date(to).getTime()));
  const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}?${query}`;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const response = await fetchImpl(url, { headers: lichessHeaders(), signal });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers?.get?.("retry-after") || 0);
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 400 * (attempt + 1));
        lastError = new Error(`lichess_${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`lichess_${response.status}`);
      const text = await response.text();
      return {
        text,
        complete: true,
        bytes: Buffer.byteLength(text, "utf8"),
        truncated: !response.headers.get("x-complete") && false,
      };
    } catch (error) {
      if (String(error.message) === "aborted" || String(error.name) === "AbortError") throw new Error("aborted");
      if (String(error.message).startsWith("lichess_") && !String(error.message).endsWith("_429")) throw error;
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("lichess_unavailable");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
