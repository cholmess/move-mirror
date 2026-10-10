import { SPARRING_POLICY_VERSION } from "./constants.js";

export function sessionToPgn(session) {
  const headers = [
    `[Event "MoveMirror Sparring"]`,
    `[Site "Local"]`,
    `[TrainingGame "true"]`,
    `[SparringPolicy "${SPARRING_POLICY_VERSION}"]`,
    `[Mode "${session.mode}"]`,
    `[UserColor "${session.userColor}"]`,
    `[Result "${session.result ?? "*"}"]`,
  ];
  const moves = [];
  for (let i = 0; i < session.movesSan.length; i += 1) {
    if (i % 2 === 0) moves.push(`${Math.floor(i / 2) + 1}. ${session.movesSan[i]}`);
    else moves.push(session.movesSan[i]);
  }
  return `${headers.join("\n")}\n\n${moves.join(" ")} ${session.result ?? "*"}\n`;
}
