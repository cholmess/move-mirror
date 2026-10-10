import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  cancelJob,
  fetchIdentity,
  fetchJobs,
  importPgnFiles,
  importPgnText,
  importPlatform,
  previewPgnText,
  resumeJob,
  updateIdentity,
} from "../api/gamesClient";
import type { ImportJob, PlayerIdentity, PgnPreview } from "../types/games";
import { formatErrorCode, formatImportSource, formatImportStatus } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

export function ImportHub() {
  const { t, i18n } = useTranslation(["import", "common", "errors"]);
  const locale = i18n.language as SupportedLocale;
  const [pgn, setPgn] = useState("");
  const [previewed, setPreviewed] = useState(false);
  const [files, setFiles] = useState<Array<{ name: string; text: string }>>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PgnPreview | null>(null);
  const [pgnAlias, setPgnAlias] = useState("");
  const detected = useMemo(() => preview?.detected ?? 0, [preview]);

  useEffect(() => {
    Promise.all([fetchJobs(), fetchIdentity()])
      .then(([jobResult, player]) => {
        setJobs(jobResult.jobs);
        setIdentity(player);
      })
      .catch(() => setError(t("connectionError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, operation: () => Promise<ImportJob | { jobs: ImportJob[] }>) => {
    setBusy(key);
    setError("");
    try {
      const result = await operation();
      const nextJobs = "jobs" in result ? result.jobs : [result];
      setJobs((current) => [...nextJobs, ...current.filter((job) => !nextJobs.some((next) => next.id === job.id))]);
      setPreviewed(false);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("importFailed"));
    } finally {
      setBusy("");
    }
  };

  const readFiles = async (list: FileList | File[]) => {
    const accepted = [...list].filter((file) => file.name.toLowerCase().endsWith(".pgn"));
    const loaded = await Promise.all(
      accepted.map(async (file) => {
        if (file.size > 10 * 1024 * 1024) throw new Error("pgn_too_large");
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { name: file.name, bytes: bufferToBase64(bytes), text: decodeBytes(bytes) };
      }),
    );
    setFiles(loaded);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void readFiles(event.dataTransfer.files);
  };

  return (
    <div className="page import-hub">
      <div className="page-head">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p className="muted">{t("lead")}</p>
      </div>

      {error && (
        <p className="card import-error" role="alert">
          {error}
        </p>
      )}

      <div className="import-grid">
        <PlatformCard
          title={t("chesscom")}
          aliases={identity?.chessComUsernames ?? []}
          busy={busy === "chess-com"}
          onSaveAliases={(aliases) => {
            if (identity) return updateIdentity({ chessComUsernames: aliases }).then(setIdentity);
          }}
          onImport={(input) => run("chess-com", () => importPlatform("chess-com", input))}
        />
        <PlatformCard
          title={t("lichess")}
          aliases={identity?.lichessUsernames ?? []}
          busy={busy === "lichess"}
          onSaveAliases={(aliases) => {
            if (identity) return updateIdentity({ lichessUsernames: aliases }).then(setIdentity);
          }}
          onImport={(input) => run("lichess", () => importPlatform("lichess", input))}
        />

        <section className="card import-card">
          <p className="eyebrow">{t("filesEyebrow")}</p>
          <h2>{t("uploadPgn")}</h2>
          <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            {t("dropHint")}
            <label className="btn">
              {t("chooseFiles")}
              <input
                className="visually-hidden"
                type="file"
                accept=".pgn,application/x-chess-pgn"
                multiple
                onChange={(event) => event.target.files && void readFiles(event.target.files)}
              />
            </label>
          </div>
          {files.length > 0 && (
            <p className="small">
              {t("fileCount", { count: files.length, names: files.map((file) => file.name).join(", ") })}
            </p>
          )}
          <button
            className="btn primary"
            disabled={!files.length || busy === "files"}
            onClick={() => run("files", () => importPgnFiles(files))}
          >
            {busy === "files" ? t("importing") : t("importFiles")}
          </button>
        </section>

        <section className="card import-card pgn-editor-card">
          <p className="eyebrow">{t("textEyebrow")}</p>
          <h2>{t("pastePgn")}</h2>
          <textarea
            className="textarea pgn-editor"
            aria-label={t("pgnAria")}
            value={pgn}
            onChange={(event) => {
              setPgn(event.target.value);
              setPreviewed(false);
            }}
            placeholder={t("pgnPlaceholder")}
          />
          {previewed && preview && (
            <div className="preview-box">
              <strong>{t("previewDetected", { count: detected })}</strong>
              <p className="small muted">
                {t("previewValid", {
                  valid: preview.valid,
                  failed: preview.failed,
                  excluded: preview.excluded,
                })}
              </p>
              {preview.games
                .filter((game) => game.error)
                .map((game) => (
                  <p className="small warn" key={game.index}>
                    {t("previewGameError", {
                      index: game.index + 1,
                      message: game.error?.message ?? "",
                    })}
                  </p>
                ))}
            </div>
          )}
          <div className="actions">
            <button
              className="btn"
              disabled={!pgn.trim()}
              onClick={() => {
                previewPgnText(pgn)
                  .then((result) => {
                    setPreview(result);
                    setPreviewed(true);
                  })
                  .catch((cause) => {
                    const code = cause instanceof Error ? cause.message : "";
                    setError(code ? formatErrorCode(code, locale) : t("validateFailed"));
                  });
              }}
            >
              {t("validatePreview")}
            </button>
            <button
              className="btn primary"
              disabled={!previewed || busy === "text"}
              onClick={() => run("text", () => importPgnText(pgn))}
            >
              {t("confirmImport")}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setPgn("");
                setPreviewed(false);
                setPreview(null);
              }}
            >
              {t("clear")}
            </button>
          </div>
        </section>

        <section className="card import-card">
          <p className="eyebrow">{t("boardEyebrow")}</p>
          <h2>{t("manualTitle")}</h2>
          <p className="muted">{t("manualLead")}</p>
          <Link className="btn primary" to="/import/manual">
            {t("openBoard")}
          </Link>
        </section>

        <section className="card import-card" data-testid="scoresheet-import-card">
          <p className="eyebrow">{t("scoresheetEyebrow")}</p>
          <h2>{t("scoresheetTitle")}</h2>
          <p className="muted">{t("scoresheetLead")}</p>
          <Link className="btn primary" to="/import/scoresheet">
            {t("openScoresheet")}
          </Link>
        </section>

        <section className="card import-card">
          <p className="eyebrow">{t("identityEyebrow")}</p>
          <h2>{t("pgnAliasTitle")}</h2>
          <p className="muted small">{t("pgnAliasHint")}</p>
          <div className="actions">
            <input
              className="input"
              value={pgnAlias}
              onChange={(event) => setPgnAlias(event.target.value)}
              placeholder={t("sheetNamePlaceholder")}
            />
            <button
              className="btn"
              disabled={!pgnAlias.trim() || !identity}
              onClick={() => {
                if (!identity) return;
                updateIdentity({ pgnNameAliases: [...identity.pgnNameAliases, pgnAlias.trim()] }).then((next) => {
                  setIdentity(next);
                  setPgnAlias("");
                });
              }}
            >
              {t("addAlias")}
            </button>
          </div>
          <p className="small">{identity?.pgnNameAliases.join(", ") || t("noPgnAliases")}</p>
        </section>
      </div>

      <section className="card import-history">
        <h2>{t("recentImports")}</h2>
        {jobs.length === 0 ? (
          <p className="muted">{t("noImports")}</p>
        ) : (
          jobs.slice(0, 10).map((job) => (
            <JobSummary
              key={job.id}
              job={job}
              locale={locale}
              onCancel={() =>
                cancelJob(job.id).then((next) =>
                  setJobs((current) => current.map((item) => (item.id === next.id ? next : item))),
                )
              }
              onResume={() =>
                resumeJob(job.id).then((next) =>
                  setJobs((current) => [next, ...current.filter((item) => item.id !== next.id)]),
                )
              }
            />
          ))
        )}
      </section>
    </div>
  );
}

function PlatformCard({
  title,
  aliases,
  busy,
  onImport,
  onSaveAliases,
}: {
  title: string;
  aliases: string[];
  busy: boolean;
  onImport: (input: { username: string; from?: string; to?: string }) => void;
  onSaveAliases: (aliases: string[]) => Promise<unknown> | void;
}) {
  const { t } = useTranslation("import");
  const [username, setUsername] = useState(aliases[0] ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => setUsername(aliases[0] ?? ""), [aliases]);
  return (
    <section className="card import-card">
      <p className="eyebrow">{t("publicSync")}</p>
      <h2>{title}</h2>
      <label className="field">
        <span>{t("username")}</span>
        <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <div className="date-range">
        <label className="field">
          <span>{t("fromDate")}</span>
          <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("toDate")}</span>
          <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button
          className="btn primary"
          disabled={!username.trim() || busy}
          onClick={() => onImport({ username, from: from || undefined, to: to || undefined })}
        >
          {busy ? t("syncing") : t("sync")}
        </button>
        <button
          className="btn"
          disabled={!username.trim()}
          onClick={() => void onSaveAliases([username, ...aliases.filter((alias) => alias.toLowerCase() !== username.toLowerCase())])}
        >
          {t("saveAlias")}
        </button>
      </div>
    </section>
  );
}

function JobSummary({
  job,
  locale,
  onCancel,
  onResume,
}: {
  job: ImportJob;
  locale: SupportedLocale;
  onCancel: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation(["import", "common"]);
  return (
    <article className="job-summary" data-testid={`job-${job.id}`}>
      <div>
        <strong>{formatImportSource(job.sourceType, locale)}</strong>{" "}
        <span className={`status status-${job.status}`}>{formatImportStatus(job.status, locale)}</span>
      </div>
      <p>
        {t("jobSummaryShort", {
          discovered: job.summary.discovered,
          newCount: job.summary.newCanonicalGames,
          existingCount: job.summary.mergedDuplicates + job.summary.exactDuplicates,
          reviewCount: job.summary.requiresReview,
          failedCount: job.summary.failed,
        })}
      </p>
      {job.errors.slice(0, 3).map((item, index) => (
        <p className="small warn" key={`${item.code}-${index}`}>
          {t("gameErrorLine", {
            index: (item.gameIndex ?? index) + 1,
            message: item.message,
            ply: item.ply ? t("plySuffix", { ply: item.ply }) : "",
          })}
        </p>
      ))}
      <div className="actions">
        {["queued", "running"].includes(job.status) && (
          <button className="btn" onClick={onCancel}>
            {t("common:cancel")}
          </button>
        )}
        {["cancelled", "failed"].includes(job.status) &&
          (job.sourceType === "chess_com" || job.sourceType === "lichess") && (
            <button className="btn" onClick={onResume}>
              {t("resume")}
            </button>
          )}
      </div>
    </article>
  );
}

function bufferToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function decodeBytes(bytes: Uint8Array) {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return utf8.includes("\uFFFD") ? new TextDecoder("iso-8859-1").decode(bytes) : utf8;
}
