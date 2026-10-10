import { performance } from "node:perf_hooks";

const TEN_MINUTES_MS = 10 * 60 * 1000;

function clockTimestamp() {
  return new Date().toISOString();
}

/** @typedef {"untimed"|"10+0"} ClockMode */
/** @typedef {"white"|"black"} ClockColor */
/** @typedef {"running"|"paused"|"expired"|"finished"} ClockStatus */
/** @typedef {"engine_wait"|"engine_error"|"server_restart"|null} PauseReason */

/**
 * @returns {import("./clock.js").SparringClock}
 */
export function initialClock(mode) {
  if (mode === "10+0") {
    return {
      mode: "10+0",
      whiteRemainingMs: TEN_MINUTES_MS,
      blackRemainingMs: TEN_MINUTES_MS,
      activeColor: null,
      status: "paused",
      pauseReason: null,
      runningSinceMono: null,
      monotonicEpochId: null,
      updatedAtUtc: clockTimestamp(),
    };
  }
  return { mode: "untimed" };
}

function legacyActiveColor(clock) {
  if (clock.activeColor != null) return clock.activeColor;
  if (clock.runningColor != null) return clock.runningColor;
  return null;
}

/** Normalize persisted shape without changing elapsed time semantics. */
export function migratePersistedClock(clock) {
  if (!clock || clock.mode === "untimed") return clock ?? { mode: "untimed" };
  const activeColor = legacyActiveColor(clock);
  const hasRunningMono = clock.runningSinceMono != null;
  let status = clock.status;
  if (!status) {
    if (clock.timeoutDeclared || clock.status === "expired") status = "expired";
    else if (hasRunningMono && activeColor) status = "running";
    else status = "paused";
  }
  const next = {
    ...clock,
    activeColor,
    status,
    pauseReason: clock.pauseReason ?? null,
    runningSinceMono: clock.runningSinceMono ?? null,
    monotonicEpochId: clock.monotonicEpochId ?? null,
    updatedAtUtc: clock.updatedAtUtc ?? clockTimestamp(),
  };
  delete next.runningColor;
  delete next.lastStartedAt;
  return next;
}

function isRunningInEpoch(clock, currentEpochId) {
  return (
    clock.mode === "10+0" &&
    clock.status === "running" &&
    clock.activeColor &&
    clock.runningSinceMono != null &&
    clock.monotonicEpochId != null &&
    clock.monotonicEpochId === currentEpochId
  );
}

function deductRunning(clock, nowMono = performance.now()) {
  if (clock.mode === "untimed" || clock.status !== "running" || !clock.activeColor || clock.runningSinceMono == null) {
    return clock;
  }
  const elapsed = Math.max(0, nowMono - clock.runningSinceMono);
  const next = {
    ...clock,
    activeColor: null,
    status: "paused",
    runningSinceMono: null,
    monotonicEpochId: null,
    updatedAtUtc: clockTimestamp(),
  };
  if (clock.activeColor === "white") {
    next.whiteRemainingMs = Math.max(0, (clock.whiteRemainingMs ?? 0) - elapsed);
  } else {
    next.blackRemainingMs = Math.max(0, (clock.blackRemainingMs ?? 0) - elapsed);
  }
  return next;
}

/**
 * After a new server process loads a session: never reuse stale monotonic refs.
 * @returns {{ clock: object, changed: boolean }}
 */
export function recoverClockAfterProcessChange(clock, currentEpochId, nowMono = performance.now()) {
  const migrated = migratePersistedClock(clock);
  if (migrated.mode === "untimed") return { clock: migrated, changed: migrated !== clock };
  if (["paused", "expired", "finished"].includes(migrated.status)) {
    if (migrated.runningSinceMono == null && migrated.monotonicEpochId == null) {
      return { clock: migrated, changed: migrated !== clock };
    }
    return {
      clock: {
        ...migrated,
        runningSinceMono: null,
        monotonicEpochId: null,
        updatedAtUtc: clockTimestamp(),
      },
      changed: true,
    };
  }
  if (migrated.status === "running" && migrated.monotonicEpochId !== currentEpochId) {
    return {
      clock: {
        ...migrated,
        status: "paused",
        pauseReason: "server_restart",
        activeColor: migrated.activeColor ?? null,
        runningSinceMono: null,
        monotonicEpochId: null,
        updatedAtUtc: clockTimestamp(),
      },
      changed: true,
    };
  }
  if (migrated.status === "running" && isRunningInEpoch(migrated, currentEpochId)) {
    return { clock: migrated, changed: migrated !== clock };
  }
  return { clock: migrated, changed: migrated !== clock };
}

export function consolidateClock(clock, currentEpochId, nowMono = performance.now()) {
  const migrated = migratePersistedClock(clock);
  if (migrated.mode === "untimed") return migrated;
  if (!isRunningInEpoch(migrated, currentEpochId)) return migrated;
  return deductRunning(migrated, nowMono);
}

export function startClock(clock, color, currentEpochId, nowMono = performance.now()) {
  if (clock.mode === "untimed") return { ...clock };
  const consolidated = consolidateClock(clock, currentEpochId, nowMono);
  return {
    ...consolidated,
    activeColor: color,
    status: "running",
    pauseReason: null,
    runningSinceMono: nowMono,
    monotonicEpochId: currentEpochId,
    updatedAtUtc: clockTimestamp(),
  };
}

export function pauseClock(clock, { reason, currentEpochId, nowMono = performance.now() } = {}) {
  if (clock.mode === "untimed") return { ...clock };
  const migrated = migratePersistedClock(clock);
  let consolidated = migrated;
  if (currentEpochId && isRunningInEpoch(migrated, currentEpochId)) {
    consolidated = deductRunning(migrated, nowMono);
  } else if (migrated.status === "running") {
    consolidated = {
      ...migrated,
      activeColor: null,
      status: "paused",
      runningSinceMono: null,
      monotonicEpochId: null,
      updatedAtUtc: clockTimestamp(),
    };
  }
  return {
    ...consolidated,
    pauseReason: reason !== undefined ? reason : (consolidated.pauseReason ?? null),
    updatedAtUtc: clockTimestamp(),
  };
}

export function pauseClockAfterMove(clock, currentEpochId, nowMono = performance.now()) {
  return pauseClock(clock, { currentEpochId, nowMono, reason: undefined });
}

export function switchClockAfterMove(clock, moverColor, currentEpochId, nowMono = performance.now()) {
  const paused = pauseClock(clock, { currentEpochId, nowMono });
  const nextColor = moverColor === "white" ? "black" : "white";
  return startClock(paused, nextColor, currentEpochId, nowMono);
}

export function markClockExpired(clock, currentEpochId, nowMono = performance.now()) {
  if (clock.mode === "untimed") return clock;
  const paused = pauseClock(clock, { currentEpochId, nowMono, reason: null });
  return { ...paused, status: "expired", pauseReason: null, updatedAtUtc: clockTimestamp() };
}

export function markClockFinished(clock, currentEpochId, nowMono = performance.now()) {
  if (clock.mode === "untimed") return clock;
  const paused = pauseClock(clock, { currentEpochId, nowMono, reason: null });
  return { ...paused, status: "finished", pauseReason: null, updatedAtUtc: clockTimestamp() };
}

export function resumeClockAfterServerRestart(clock, currentEpochId, nowMono = performance.now()) {
  if (clock.mode !== "10+0") return { clock, resumed: false };
  const migrated = migratePersistedClock(clock);
  if (migrated.status === "running" && migrated.monotonicEpochId === currentEpochId) {
    return { clock: migrated, resumed: false };
  }
  if (migrated.pauseReason !== "server_restart" || migrated.status !== "paused") {
    return { clock: migrated, resumed: false };
  }
  const color = migrated.activeColor;
  if (!color) return { clock: migrated, resumed: false };
  return {
    clock: startClock(migrated, color, currentEpochId, nowMono),
    resumed: true,
  };
}

export function clockResumeRequired(clock) {
  const migrated = migratePersistedClock(clock);
  return migrated.mode === "10+0" && migrated.status === "paused" && migrated.pauseReason === "server_restart";
}

export function timeoutResult(clock, currentEpochId, nowMono = performance.now()) {
  if (clock.mode === "untimed") return null;
  const view = clockPublicView(clock, currentEpochId, nowMono);
  if (view.whiteRemainingMs != null && view.whiteRemainingMs <= 0) {
    return { result: "0-1", termination: "timeout", loser: "white" };
  }
  if (view.blackRemainingMs != null && view.blackRemainingMs <= 0) {
    return { result: "1-0", termination: "timeout", loser: "black" };
  }
  return null;
}

export function clockPublicView(clock, currentEpochId, nowMono = performance.now()) {
  const migrated = migratePersistedClock(clock);
  if (migrated.mode === "untimed") return { mode: "untimed" };
  if (!isRunningInEpoch(migrated, currentEpochId)) {
    return {
      mode: migrated.mode,
      whiteRemainingMs: migrated.whiteRemainingMs,
      blackRemainingMs: migrated.blackRemainingMs,
      activeColor: migrated.status === "running" ? migrated.activeColor : null,
      status: migrated.status ?? "paused",
    };
  }
  const elapsed = Math.max(0, nowMono - migrated.runningSinceMono);
  if (migrated.activeColor === "white") {
    return {
      mode: migrated.mode,
      whiteRemainingMs: Math.max(0, (migrated.whiteRemainingMs ?? 0) - elapsed),
      blackRemainingMs: migrated.blackRemainingMs,
      activeColor: "white",
      status: "running",
    };
  }
  return {
    mode: migrated.mode,
    whiteRemainingMs: migrated.whiteRemainingMs,
    blackRemainingMs: Math.max(0, (migrated.blackRemainingMs ?? 0) - elapsed),
    activeColor: "black",
    status: "running",
  };
}

export function clockPublicDto(clock, currentEpochId, nowMono = performance.now()) {
  const view = clockPublicView(clock, currentEpochId, nowMono);
  if (view.mode === "untimed") return { mode: "untimed" };
  return {
    ...view,
    resumeRequired: clockResumeRequired(clock),
  };
}

/** @deprecated use clockPublicDto */
export function clockPublicDtoLegacy(clock, nowMono = performance.now()) {
  return clockPublicDto(clock, clock.monotonicEpochId, nowMono);
}
