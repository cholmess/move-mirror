import { useCallback, useEffect, useState } from "react";
import type { AppState } from "../types/learning";
import {
  fetchValidationStatus,
  migrateValidationFromLocal,
  syncValidationPedagogy,
  type ValidationPublicStatus,
} from "../api/validationClient";

const MIGRATION_FLAG = "move-mirror-validation-migrated-v1";

export function useValidationLedger(state: AppState) {
  const [status, setStatus] = useState<ValidationPublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchValidationStatus());
      setError(null);
    } catch {
      setError("load_failed");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (typeof localStorage !== "undefined" && !localStorage.getItem(MIGRATION_FLAG)) {
          await migrateValidationFromLocal({
            version: state.version,
            pedagogyEvents: state.pedagogyEvents,
            interventionQualification: state.interventionQualification,
            attempts: state.attempts,
            progress: state.progress,
            lessonVersion: state.pedagogyEvents.find((e) => e.lessonVersion)?.lessonVersion,
          });
          localStorage.setItem(MIGRATION_FLAG, new Date().toISOString());
        }
        await syncValidationPedagogy(state.pedagogyEvents);
        await refresh();
      } catch {
        setError("sync_failed");
      }
    })();
  }, [state.pedagogyEvents, state.version, state.attempts, state.progress, state.interventionQualification, refresh]);

  return { status, error, refresh };
}
