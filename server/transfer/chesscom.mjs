import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { sha256 } from "./store.mjs";

export const CHESSCOM_USER_AGENT = "MoveMirror/0.3 (personal coach; local use)";

export function chesscomHeaders() {
  return {
    "User-Agent": CHESSCOM_USER_AGENT,
    Accept: "application/json",
  };
}

export function monthFromArchive(url) {
  const parts = String(url).split("/").filter(Boolean);
  const month = parts[parts.length - 1];
  const year = parts[parts.length - 2];
  return `${year}/${month}`;
}

export function isMonthBefore(archiveUrl, cutoffEndTime) {
  const stamp = new Date(cutoffEndTime * 1000);
  const cutoff = `${stamp.getUTCFullYear()}/${String(stamp.getUTCMonth() + 1).padStart(2, "0")}`;
  return monthFromArchive(archiveUrl) < cutoff;
}

export async function fetchText(url, { fetchImpl = fetch, sleep = delay, signal, attempts = 4 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) throw new Error("aborted");
    try {
      const response = await fetchImpl(url, { headers: chesscomHeaders(), signal });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers?.get?.("retry-after") || 0);
        const wait = retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 400 * (attempt + 1);
        await sleep(wait);
        lastError = new Error(`chesscom_${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`chesscom_${response.status}`);
      const text = await response.text();
      return { url, text, sha256: sha256(text), json: JSON.parse(text) };
    } catch (error) {
      if (String(error.message) === "aborted") throw error;
      if (String(error.message).startsWith("chesscom_") && !String(error.message).endsWith("_429")) {
        throw error;
      }
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError ?? new Error("chesscom_unavailable");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchNewGames({
  username,
  cutoffEndTime,
  fetchImpl,
  sleep = delay,
  signal,
  seenArchives = new Set(),
  onArchive,
  pauseMs = 1100,
}) {
  const archivesUrl = `https://api.chess.com/pub/player/${username}/games/archives`;
  const archives = await fetchText(archivesUrl, { fetchImpl, sleep, signal });
  const months = [...(archives.json.archives ?? [])].reverse();
  const games = [];
  const fetched = [{ url: archivesUrl, sha256: archives.sha256, bytes: archives.text.length }];
  for (const url of months) {
    if (signal?.aborted) throw new Error("aborted");
    if (isMonthBefore(url, cutoffEndTime)) break;
    if (seenArchives.has(url)) continue;
    const month = await fetchText(url, { fetchImpl, sleep, signal });
    fetched.push({ url, sha256: month.sha256, bytes: month.text.length });
    if (onArchive) onArchive(fetched[fetched.length - 1]);
    for (const game of month.json.games ?? []) games.push(game);
    if (pauseMs > 0) await sleep(pauseMs);
  }
  return { games, fetched };
}

export function loadFixtureGames(dir) {
  const archives = JSON.parse(readFileSync(path.join(dir, "archives.json"), "utf8"));
  const games = [];
  const fetched = [];
  for (const url of archives.archives ?? []) {
    const name = `${monthFromArchive(url).replace("/", "-")}.json`;
    const file = path.join(dir, name);
    const text = readFileSync(file, "utf8");
    const json = JSON.parse(text);
    fetched.push({ url, sha256: sha256(text), bytes: text.length, offline: true });
    for (const game of json.games ?? []) games.push(game);
  }
  return { games, fetched, fixtureFiles: readdirSync(dir) };
}
