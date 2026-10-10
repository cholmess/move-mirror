import path from "node:path";

export function scoresheetRoot(gamesRoot) {
  return path.join(gamesRoot, "scoresheets");
}

export function assertInsideScoresheetRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    throw new Error("scoresheet_path_outside_root");
  }
  return resolvedTarget;
}

export function safeDraftFilename(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("invalid_draft_id");
  return `${id}.json`;
}
