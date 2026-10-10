import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SPARRING_SESSION_VERSION, SPARRING_PROFILE_VERSION } from "../../shared/sparring/constants.js";
import { emptySparringProfile } from "../../shared/sparring/profile.js";
import { initialClock } from "../../shared/sparring/clock.js";

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function createSparringStore(root) {
  const dirs = {
    root,
    sessions: path.join(root, "sessions"),
    reviews: path.join(root, "reviews"),
    profile: path.join(root, "profile"),
    cache: path.join(root, "cache"),
    metrics: path.join(root, "metrics.json"),
  };

  function ensure() {
    for (const dir of Object.values(dirs)) {
      if (dir.endsWith(".json")) continue;
      fs.mkdirSync(dir, { recursive: true });
    }
    const profileFile = path.join(dirs.profile, "local.json");
    if (!fs.existsSync(profileFile)) atomicJson(profileFile, emptySparringProfile());
  }

  function sessionPath(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("bad_session_id");
    return path.join(dirs.sessions, `${id}.json`);
  }

  function saveSession(session) {
    session.updatedAt = new Date().toISOString();
    atomicJson(sessionPath(session.id), session);
    return session;
  }

  function readSession(id) {
    return readJson(sessionPath(id));
  }

  function listSessions() {
    ensure();
    const files = fs.readdirSync(dirs.sessions).filter((f) => f.endsWith(".json"));
    return files
      .map((f) => readJson(path.join(dirs.sessions, f)))
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function createSession(input) {
    ensure();
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      version: SPARRING_SESSION_VERSION,
      mode: input.mode,
      status: "created",
      userColor: input.userColor,
      startingFen: input.startingFen,
      movesUci: [],
      movesSan: [],
      style: input.style ?? "balanced",
      seed: input.seed ?? randomUUID(),
      policyVersion: input.policyVersion,
      profileSnapshot: input.profileSnapshot,
      source: input.source,
      clock: initialClock(input.clockMode ?? "untimed"),
      decisions: [],
      hintsUsed: 0,
      hintUsedPlies: [],
      result: null,
      termination: null,
      reviewStatus: "not_started",
      maxPlies: input.maxPlies ?? null,
      pedagogicalGoalKey: input.pedagogicalGoalKey ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      pendingAgentIdempotency: null,
      enginePaused: false,
      timeoutDeclared: false,
    };
    return saveSession(session);
  }

  function readProfile() {
    ensure();
    return readJson(path.join(dirs.profile, "local.json"), emptySparringProfile());
  }

  function saveProfile(profile) {
    atomicJson(path.join(dirs.profile, "local.json"), {
      ...profile,
      version: SPARRING_PROFILE_VERSION,
      updatedAt: new Date().toISOString(),
    });
  }

  function saveReview(review) {
    atomicJson(path.join(dirs.reviews, `${review.sessionId}.json`), review);
  }

  function readReview(sessionId) {
    return readJson(path.join(dirs.reviews, `${sessionId}.json`));
  }

  function recordMetric(event) {
    const file = dirs.metrics;
    const prev = readJson(file, { events: [] });
    prev.events.push({ ...event, at: new Date().toISOString() });
    if (prev.events.length > 5000) prev.events = prev.events.slice(-5000);
    atomicJson(file, prev);
  }

  return {
    ensure,
    dirs,
    createSession,
    saveSession,
    readSession,
    listSessions,
    readProfile,
    saveProfile,
    saveReview,
    readReview,
    recordMetric,
  };
}
