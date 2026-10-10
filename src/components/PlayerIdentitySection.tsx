import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchIdentity, reconcileIdentity, updateIdentity } from "../api/gamesClient";
import type { PlayerIdentityPublic, ReconcileSummary } from "../types/games";
import { formatErrorCode } from "../i18n/presenters";
import type { SupportedLocale } from "../i18n/types";

type Platform = "chess_com" | "lichess" | "pgn";

export function PlayerIdentitySection() {
  const { t, i18n } = useTranslation(["profile", "import", "errors"]);
  const locale = i18n.language as SupportedLocale;
  const [identity, setIdentity] = useState<PlayerIdentityPublic | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [drafts, setDrafts] = useState({ chess_com: "", lichess: "", pgn: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconcilePreview, setReconcilePreview] = useState<ReconcileSummary | null>(null);

  const load = useCallback(() => {
    fetchIdentity()
      .then((result) => {
        setIdentity(result);
        setDisplayName(result.displayName);
      })
      .catch(() => setError(t("identity.loadError")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const saveDisplayName = async () => {
    setError("");
    setBusy(true);
    try {
      const next = await updateIdentity({ displayName: displayName.trim() });
      setIdentity(next);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("identity.saveNameError"));
    } finally {
      setBusy(false);
    }
  };

  const addAlias = async (platform: Platform) => {
    if (!identity) return;
    setError("");
    setBusy(true);
    try {
      const value = drafts[platform].trim();
      const patch =
        platform === "chess_com"
          ? { chessComUsernames: [...identity.chessComUsernames, value] }
          : platform === "lichess"
            ? { lichessUsernames: [...identity.lichessUsernames, value] }
            : { pgnNameAliases: [...identity.pgnNameAliases, value] };
      const next = await updateIdentity(patch);
      setIdentity(next);
      setDrafts((current) => ({ ...current, [platform]: "" }));
    } catch (cause) {
      setError(formatIdentityError(cause, locale));
    } finally {
      setBusy(false);
    }
  };

  const removeAlias = async (platform: Platform, alias: string) => {
    if (!identity) return;
    setError("");
    setBusy(true);
    try {
      const patch =
        platform === "chess_com"
          ? { chessComUsernames: identity.chessComUsernames.filter((item) => item !== alias) }
          : platform === "lichess"
            ? { lichessUsernames: identity.lichessUsernames.filter((item) => item !== alias) }
            : { pgnNameAliases: identity.pgnNameAliases.filter((item) => item !== alias) };
      const next = await updateIdentity(patch);
      setIdentity(next);
      setReconcilePreview(null);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("errors:identity_update_failed"));
    } finally {
      setBusy(false);
    }
  };

  const previewReconcile = async () => {
    setError("");
    setBusy(true);
    try {
      const summary = await reconcileIdentity({ dryRun: true });
      setReconcilePreview(summary);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("identity.previewFailed"));
    } finally {
      setBusy(false);
    }
  };

  const confirmReconcile = async () => {
    setError("");
    setBusy(true);
    try {
      const summary = await reconcileIdentity({ confirm: true });
      setReconcilePreview(summary);
      load();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code ? formatErrorCode(code, locale) : t("identity.applyFailed"));
    } finally {
      setBusy(false);
    }
  };

  if (!identity) {
    return (
      <section className="card" data-testid="player-identity-section">
        <h2>{t("identity.title")}</h2>
        <p className="muted">{t("identity.loading")}</p>
      </section>
    );
  }

  return (
    <section className="card" data-testid="player-identity-section">
      <h2>{t("identity.title")}</h2>
      <p className="muted small">{t("identity.hint")}</p>
      {error && (
        <p className="import-error" role="alert">
          {error}
        </p>
      )}

      <label className="field">
        <span>{t("identity.displayName")}</span>
        <input
          className="input"
          data-testid="identity-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      <button type="button" className="btn" disabled={busy || !displayName.trim()} onClick={() => void saveDisplayName()}>
        {t("identity.saveName")}
      </button>

      <AliasList
        platform="chess_com"
        title={t("import:chesscom")}
        aliases={identity.chessComUsernames}
        stats={identity.aliases}
        draft={drafts.chess_com}
        onDraft={(value) => setDrafts((current) => ({ ...current, chess_com: value }))}
        onAdd={() => void addAlias("chess_com")}
        onRemove={(alias) => void removeAlias("chess_com", alias)}
        busy={busy}
        hint={t("identity.chesscomHint")}
      />
      <AliasList
        platform="lichess"
        title={t("import:lichess")}
        aliases={identity.lichessUsernames}
        stats={identity.aliases}
        draft={drafts.lichess}
        onDraft={(value) => setDrafts((current) => ({ ...current, lichess: value }))}
        onAdd={() => void addAlias("lichess")}
        onRemove={(alias) => void removeAlias("lichess", alias)}
        busy={busy}
      />
      <AliasList
        platform="pgn"
        title={t("import:pgnAliasTitle")}
        aliases={identity.pgnNameAliases}
        stats={identity.aliases}
        draft={drafts.pgn}
        onDraft={(value) => setDrafts((current) => ({ ...current, pgn: value }))}
        onAdd={() => void addAlias("pgn")}
        onRemove={(alias) => void removeAlias("pgn", alias)}
        busy={busy}
        hint={t("identity.pgnHint")}
      />

      <div className="review-panel">
        <p>
          <strong>{t("identity.reconcileTitle")}</strong>
        </p>
        <p className="small muted">{t("identity.reconcileHint")}</p>
        <div className="actions">
          <button type="button" className="btn" disabled={busy} data-testid="reconcile-preview" onClick={() => void previewReconcile()}>
            {t("identity.previewReconcile")}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !reconcilePreview || reconcilePreview.wouldResolve === 0}
            data-testid="reconcile-confirm"
            onClick={() => void confirmReconcile()}
          >
            {t("identity.applyReconcile")}
          </button>
        </div>
        {reconcilePreview && (
          <ul className="stat-list small">
            <li>
              {t("identity.candidates")}: {reconcilePreview.candidates}
            </li>
            <li>
              {t("identity.wouldResolve")}: {reconcilePreview.wouldResolve}
            </li>
            <li>
              {t("identity.ambiguous")}: {reconcilePreview.ambiguous}
            </li>
            <li>
              {t("identity.skippedProtected")}: {reconcilePreview.skippedProtected}
            </li>
            <li>
              {t("identity.skippedVerified")}: {reconcilePreview.skippedVerified}
            </li>
            {reconcilePreview.resolved > 0 && (
              <li>
                {t("identity.resolvedNow")}: {reconcilePreview.resolved}
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatIdentityError(cause: unknown, locale: SupportedLocale) {
  const code = cause instanceof Error ? cause.message : "identity_update_failed";
  return formatErrorCode(code, locale);
}

function AliasList({
  platform,
  title,
  aliases,
  stats,
  draft,
  onDraft,
  onAdd,
  onRemove,
  busy,
  hint,
}: {
  platform: Platform;
  title: string;
  aliases: string[];
  stats: PlayerIdentityPublic["aliases"];
  draft: string;
  onDraft: (value: string) => void;
  onAdd: () => void;
  onRemove: (alias: string) => void;
  busy: boolean;
  hint?: string;
}) {
  const { t } = useTranslation("profile");
  const linked = (alias: string) =>
    stats.find((item) => item.platform === platform && item.alias === alias)?.linkedGames ?? 0;

  return (
    <div className="alias-block" data-testid={`identity-${platform}`}>
      <h3>{title}</h3>
      {hint && <p className="small muted">{hint}</p>}
      <ul className="stat-list">
        {aliases.map((alias) => (
          <li key={alias} data-testid="identity-alias-row">
            <span className="mono">{alias}</span>
            <span className="muted small"> · {t("identity.activeGames", { count: linked(alias) })}</span>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => onRemove(alias)}>
              {t("identity.remove")}
            </button>
          </li>
        ))}
        {aliases.length === 0 && <li className="muted">{t("identity.noAliases")}</li>}
      </ul>
      <div className="actions">
        <input
          className="input"
          data-testid={`identity-add-${platform}`}
          value={draft}
          placeholder={title}
          onChange={(event) => onDraft(event.target.value)}
        />
        <button type="button" className="btn" disabled={busy || !draft.trim()} onClick={onAdd}>
          {t("identity.add")}
        </button>
      </div>
    </div>
  );
}
