#!/usr/bin/env python3
"""Reproducible two-pass Stockfish analysis with append-only checkpoints."""

from __future__ import annotations

import argparse
import atexit
import concurrent.futures
import hashlib
import json
import os
import platform
import subprocess
import time
from pathlib import Path

import chess
import chess.engine


ENGINE = None
NODE_BUDGET = None


def init_worker(engine_path: str, nodes: int) -> None:
    global ENGINE, NODE_BUDGET
    NODE_BUDGET = nodes
    ENGINE = chess.engine.SimpleEngine.popen_uci(engine_path)
    ENGINE.configure({"Threads": 1, "Hash": 128})
    atexit.register(ENGINE.quit)


def score_payload(score: chess.engine.PovScore, pov: chess.Color) -> dict:
    relative = score.pov(pov)
    return {
        "cp": relative.score(),
        "mate": relative.mate(),
        "numeric": relative.score(mate_score=100000),
    }


def line_payload(board: chess.Board, info: dict, pov: chess.Color) -> dict:
    pv = info.get("pv", [])
    return {
        "score": score_payload(info["score"], pov),
        "depth": info.get("depth"),
        "seldepth": info.get("seldepth"),
        "nodes": info.get("nodes"),
        "nps": info.get("nps"),
        "pv_uci": [m.uci() for m in pv[:12]],
        "first_move_uci": pv[0].uci() if pv else None,
    }


def clear_hash() -> None:
    # UCI button options accept None in python-chess.
    ENGINE.configure({"Clear Hash": None})


def analyse_one(item: dict) -> dict:
    board = chess.Board(item["fen_before"])
    played = chess.Move.from_uci(item["move_uci"])
    if played not in board.legal_moves:
        raise ValueError(f"illegal recorded move {played} at {item['key']}")
    pov = board.turn
    multipv = 2 if board.legal_moves.count() >= 2 else 1

    clear_hash()
    best_infos = ENGINE.analyse(
        board,
        chess.engine.Limit(nodes=NODE_BUDGET),
        multipv=multipv,
        info=chess.engine.INFO_ALL,
    )
    if not isinstance(best_infos, list):
        best_infos = [best_infos]

    clear_hash()
    played_info = ENGINE.analyse(
        board,
        chess.engine.Limit(nodes=NODE_BUDGET),
        root_moves=[played],
        info=chess.engine.INFO_ALL,
    )

    best = line_payload(board, best_infos[0], pov)
    second = line_payload(board, best_infos[1], pov) if len(best_infos) > 1 else None
    chosen = line_payload(board, played_info, pov)
    best_num = best["score"]["numeric"]
    chosen_num = chosen["score"]["numeric"]
    cp_loss = None if best_num is None or chosen_num is None else best_num - chosen_num

    return {
        "key": item["key"],
        "index": item["index"],
        "game_id": item["game_id"],
        "ply": item["ply"],
        "move_number": item["move_number"],
        "color": item["color"],
        "phase_proxy": item["phase_proxy"],
        "clock_before": item.get("clock_before"),
        "spent_seconds_proxy": item.get("spent_seconds_proxy"),
        "context_tags": item.get("context_tags", []),
        "fen_before": item["fen_before"],
        "played_san": item["move_san"],
        "played_uci": item["move_uci"],
        "legal_move_count": item["legal_move_count"],
        "nodes_requested": NODE_BUDGET,
        "best": best,
        "second": second,
        "played": chosen,
        "cp_loss_numeric": cp_loss,
        "played_is_best": played.uci() == best["first_move_uci"],
    }


def load_positions(path: Path) -> list[dict]:
    rows = []
    with path.open() as fh:
        for i, line in enumerate(fh):
            row = json.loads(line)
            row["index"] = i
            row["key"] = f"{row['game_id']}:{row['ply']}"
            rows.append(row)
    return rows


def load_checkpoint(path: Path) -> dict[str, dict]:
    done = {}
    if not path.exists():
        return done
    with path.open() as fh:
        for line in fh:
            try:
                row = json.loads(line)
                done[row["key"]] = row
            except (json.JSONDecodeError, KeyError):
                continue
    return done


def candidate_priority(row: dict) -> tuple[bool, float, list[str]]:
    loss = max(0, row.get("cp_loss_numeric") or 0)
    b = row["best"]["score"]
    p = row["played"]["score"]
    reasons = []
    if loss >= 50:
        reasons.append("loss_ge_50")
    if b["mate"] is not None and p["mate"] is None:
        reasons.append("missed_forced_mate")
    if (b["numeric"] or 0) >= 150 and (p["numeric"] or 0) < 50:
        reasons.append("lost_clear_advantage")
    if (b["numeric"] or 0) > -100 and (p["numeric"] or 0) <= -300:
        reasons.append("entered_losing_state")
    if row["second"]:
        bn = b["numeric"]
        sn = row["second"]["score"]["numeric"]
        if bn is not None and sn is not None and bn - sn >= 120:
            reasons.append("only_move_like")
    critical = bool(reasons)
    phase_bonus = 35 if row["phase_proxy"] == "endgame_proxy" else 0
    transition_bonus = 300 if "entered_losing_state" in reasons else 0
    mate_bonus = 600 if "missed_forced_mate" in reasons else 0
    priority = min(loss, 2000) + phase_bonus + transition_bonus + mate_bonus
    return critical, priority, reasons


def run_pass(args: argparse.Namespace) -> None:
    positions = load_positions(args.positions)
    if args.stage == "deep":
        base = load_checkpoint(args.base_checkpoint)
        ranked = []
        for pos in positions:
            row = base.get(pos["key"])
            if not row:
                continue
            critical, priority, reasons = candidate_priority(row)
            if critical:
                ranked.append((priority, pos, reasons))
        ranked.sort(key=lambda x: (-x[0], x[1]["index"]))
        positions = [x[1] for x in ranked[: args.deep_limit]]
        selection = [
            {"key": p["key"], "priority": pr, "reasons": rs}
            for pr, p, rs in ranked[: args.deep_limit]
        ]
        args.selection_output.write_text(json.dumps(selection, indent=2) + "\n")

    done = load_checkpoint(args.output)
    pending = [p for p in positions if p["key"] not in done]
    print(json.dumps({"stage": args.stage, "total": len(positions), "done": len(done), "pending": len(pending)}), flush=True)
    started = time.time()
    completed_now = 0
    if pending:
        with args.output.open("a", buffering=1) as out, concurrent.futures.ProcessPoolExecutor(
            max_workers=args.workers,
            initializer=init_worker,
            initargs=(str(args.engine), args.nodes),
        ) as pool:
            futures = {pool.submit(analyse_one, p): p for p in pending}
            for future in concurrent.futures.as_completed(futures):
                p = futures[future]
                try:
                    row = future.result()
                except Exception as exc:
                    row = {"key": p["key"], "index": p["index"], "game_id": p["game_id"], "ply": p["ply"], "error": repr(exc)}
                out.write(json.dumps(row, sort_keys=True) + "\n")
                out.flush()
                os.fsync(out.fileno())
                completed_now += 1
                if completed_now % 100 == 0 or completed_now == len(pending):
                    elapsed = max(time.time() - started, 0.001)
                    print(json.dumps({"completed_now": completed_now, "pending_initial": len(pending), "per_second": round(completed_now / elapsed, 2)}), flush=True)

    final = load_checkpoint(args.output)
    errors = sum(1 for r in final.values() if "error" in r)
    manifest = {
        "stage": args.stage,
        "positions_expected": len(positions),
        "positions_checkpointed": sum(1 for p in positions if p["key"] in final),
        "errors": errors,
        "nodes_per_analysis": args.nodes,
        "analyses_per_position": 2,
        "workers": args.workers,
        "engine_path": str(args.engine),
        "engine_sha256": hashlib.sha256(args.engine.read_bytes()).hexdigest(),
        "engine_version": subprocess.check_output([str(args.engine)], input=b"uci\nquit\n").decode(errors="replace").splitlines()[0],
        "python": platform.python_version(),
        "python_chess": chess.__version__,
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest), flush=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--stage", choices=["base", "deep"], required=True)
    p.add_argument("--engine", type=Path, required=True)
    p.add_argument("--positions", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--nodes", type=int, required=True)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--base-checkpoint", type=Path)
    p.add_argument("--selection-output", type=Path)
    p.add_argument("--deep-limit", type=int, default=800)
    args = p.parse_args()
    if args.stage == "deep" and (not args.base_checkpoint or not args.selection_output):
        p.error("deep stage requires --base-checkpoint and --selection-output")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    return args


if __name__ == "__main__":
    run_pass(parse_args())
