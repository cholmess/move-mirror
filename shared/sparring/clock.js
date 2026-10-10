import { performance } from "node:perf_hooks";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function initialClock(mode) {
  if (mode === "10+0") {
    return {
      mode: "10+0",
      whiteRemainingMs: TEN_MINUTES_MS,
      blackRemainingMs: TEN_MINUTES_MS,
      runningColor: null,
      runningSinceMono: null,
    };
  }
  return { mode: "untimed" };
}

function deductRunning(clock, nowMono = performance.now()) {
  if (clock.mode === "untimed" || !clock.runningColor || clock.runningSinceMono == null) {
    return clock;
  }
  const elapsed = Math.max(0, nowMono - clock.runningSinceMono);
  const next = { ...clock, runningColor: null, runningSinceMono: null };
  if (clock.runningColor === "white") {
    next.whiteRemainingMs = Math.max(0, (clock.whiteRemainingMs ?? 0) - elapsed);
  } else {
    next.blackRemainingMs = Math.max(0, (clock.blackRemainingMs ?? 0) - elapsed);
  }
  return next;
}

export function startClock(clock, color, nowMono = performance.now()) {
  if (clock.mode === "untimed") return { ...clock };
  const consolidated = deductRunning(clock, nowMono);
  return {
    ...consolidated,
    runningColor: color,
    runningSinceMono: nowMono,
  };
}

export function pauseClock(clock, nowMono = performance.now()) {
  if (clock.mode === "untimed") return { ...clock };
  return deductRunning(clock, nowMono);
}

/** Tras una jugada: consolidar y no arrancar reloj del rival hasta que termine su turno (p. ej. motor). */
export function pauseClockAfterMove(clock, nowMono = performance.now()) {
  return pauseClock(clock, nowMono);
}

export function switchClockAfterMove(clock, moverColor, nowMono = performance.now()) {
  const paused = pauseClock(clock, nowMono);
  const nextColor = moverColor === "white" ? "black" : "white";
  return startClock(paused, nextColor, nowMono);
}

export function timeoutResult(clock, nowMono = performance.now()) {
  if (clock.mode === "untimed") return null;
  const view = clockPublicView(clock, nowMono);
  if (view.whiteRemainingMs != null && view.whiteRemainingMs <= 0) {
    return { result: "0-1", termination: "timeout", loser: "white" };
  }
  if (view.blackRemainingMs != null && view.blackRemainingMs <= 0) {
    return { result: "1-0", termination: "timeout", loser: "black" };
  }
  return null;
}

export function clockPublicView(clock, nowMono = performance.now()) {
  if (clock.mode === "untimed") return { mode: "untimed" };
  if (!clock.runningColor || clock.runningSinceMono == null) {
    return {
      mode: clock.mode,
      whiteRemainingMs: clock.whiteRemainingMs,
      blackRemainingMs: clock.blackRemainingMs,
      runningColor: null,
    };
  }
  const elapsed = Math.max(0, nowMono - clock.runningSinceMono);
  if (clock.runningColor === "white") {
    return {
      mode: clock.mode,
      whiteRemainingMs: Math.max(0, (clock.whiteRemainingMs ?? 0) - elapsed),
      blackRemainingMs: clock.blackRemainingMs,
      runningColor: "white",
    };
  }
  return {
    mode: clock.mode,
    whiteRemainingMs: clock.whiteRemainingMs,
    blackRemainingMs: Math.max(0, (clock.blackRemainingMs ?? 0) - elapsed),
    runningColor: "black",
  };
}

export function clockPublicDto(clock, nowMono = performance.now()) {
  return clockPublicView(clock, nowMono);
}
