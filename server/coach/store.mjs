import fs from "node:fs";
import path from "node:path";

export function createCoachStore(rootDir) {
  const dir = path.join(rootDir, "coach");
  const sessionsFile = path.join(dir, "sessions.json");

  function ensure() {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(sessionsFile)) {
      fs.writeFileSync(sessionsFile, "[]", "utf8");
    }
  }

  function readAll() {
    ensure();
    return JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
  }

  function writeAll(sessions) {
    ensure();
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2), "utf8");
  }

  return {
    ensure,
    readPlan() {
      const file = path.join(dir, "training-plan.json");
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    },
    savePlan(value) {
      ensure();
      const file = path.join(dir, "training-plan.json");
      fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2), "utf8");
      fs.renameSync(file + ".tmp", file);
    },
    listSessions() {
      return readAll();
    },
    getSession(id) {
      return readAll().find((s) => s.id === id) ?? null;
    },
    saveSession(session) {
      const all = readAll();
      const idx = all.findIndex((s) => s.id === session.id);
      if (idx >= 0) all[idx] = session;
      else all.push(session);
      writeAll(all);
      return session;
    },
  };
}
