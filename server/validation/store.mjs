import fs from "node:fs";
import path from "node:path";
import { calculateInterventionQualification } from "../../shared/transfer/intervention.js";
import { calculateCoachDoseQualification } from "../../shared/coach/dose.js";

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

export function parseEventsJsonl(raw) {
  const lines = String(raw).split("\n").filter((line) => line.trim());
  const events = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      events.push(JSON.parse(line));
    } catch {
      if (i === lines.length - 1) break;
      throw new Error(`validation_corrupt_jsonl_line:${i + 1}`);
    }
  }
  return events;
}

export function createValidationStore(root) {
  const dirs = {
    root,
    events: path.join(root, "events.jsonl"),
    state: path.join(root, "state.json"),
    snapshots: path.join(root, "snapshots"),
    exports: path.join(root, "exports"),
    migrations: path.join(root, "migrations"),
  };

  let writeChain = Promise.resolve();

  function ensure() {
    fs.mkdirSync(dirs.snapshots, { recursive: true });
    fs.mkdirSync(dirs.exports, { recursive: true });
    fs.mkdirSync(dirs.migrations, { recursive: true });
    if (!fs.existsSync(dirs.events)) fs.writeFileSync(dirs.events, "");
    if (!fs.existsSync(dirs.state)) {
      atomicJson(dirs.state, {
        schemaVersion: "validation-state-v1",
        rebuiltAt: null,
        timezone: process.env.VALIDATION_TIMEZONE ?? "UTC",
        eventCount: 0,
        lastEventId: null,
        interventionQualification: calculateInterventionQualification([]),
        coachInterventionQualification: calculateCoachDoseQualification([]),
        qualifiedAt: null,
        latestSnapshotHash: null,
      });
    }
  }

  function enqueue(fn) {
    const run = writeChain.then(fn);
    writeChain = run.catch(() => {});
    return run;
  }

  function readEvents() {
    ensure();
    if (!fs.existsSync(dirs.events)) return [];
    const raw = fs.readFileSync(dirs.events, "utf8");
    if (!raw.trim()) return [];
    return parseEventsJsonl(raw);
  }

  function appendEventLine(event) {
    return enqueue(async () => {
      fs.appendFileSync(dirs.events, `${JSON.stringify(event)}\n`);
    });
  }

  function writeState(state) {
    return enqueue(async () => {
      atomicJson(dirs.state, state);
    });
  }

  function readState() {
    ensure();
    return readJson(dirs.state);
  }

  function saveSnapshot(snapshot) {
    const file = path.join(dirs.snapshots, `${snapshot.snapshotHash}.json`);
    atomicJson(file, snapshot);
    return file;
  }

  function readSnapshot(hash) {
    return readJson(path.join(dirs.snapshots, `${hash}.json`));
  }

  function saveMigrationBackup(name, body) {
    const file = path.join(dirs.migrations, name);
    atomicJson(file, body);
    return file;
  }

  function exportBundle() {
    ensure();
    return {
      exportedAt: new Date().toISOString(),
      events: readEvents(),
      state: readState(),
    };
  }

  return {
    dirs,
    ensure,
    readEvents,
    appendEventLine,
    writeState,
    readState,
    saveSnapshot,
    readSnapshot,
    saveMigrationBackup,
    exportBundle,
    enqueue,
  };
}
