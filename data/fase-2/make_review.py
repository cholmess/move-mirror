#!/usr/bin/env python3
"""Build the evidence-backed Phase 2 review from frozen engine checkpoints."""

from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import chess


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "review_output"
OUT.mkdir(exist_ok=True)
PIECE_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.open()]


def san_line(fen: str, pv: list[str], length: int = 8) -> str:
    board = chess.Board(fen)
    out = []
    for uci in pv[:length]:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            break
        out.append(board.san(move))
        board.push(move)
    return " ".join(out)


def motifs(row: dict) -> set[str]:
    board = chess.Board(row["fen_before"])
    played = chess.Move.from_uci(row["played_uci"])
    best = chess.Move.from_uci(row["best"]["first_move_uci"])
    loss = max(0, row.get("cp_loss_numeric") or 0)
    tags = set()
    if loss < 120:
        return tags
    best_forcing = board.is_capture(best) or board.gives_check(best)
    played_forcing = board.is_capture(played) or board.gives_check(played)
    if best_forcing and not played_forcing:
        tags.add("missed_forcing_move")
    if board.is_capture(played):
        tags.add("bad_capture_choice")
    piece = board.piece_at(played.from_square)
    if piece and piece.piece_type == chess.PAWN and not board.is_capture(played):
        tags.add("costly_quiet_pawn_move")
    pv = row["played"]["pv_uci"]
    if len(pv) >= 2:
        board.push(played)
        reply = chess.Move.from_uci(pv[1])
        captured = board.piece_at(reply.to_square) if board.is_capture(reply) else None
        if board.is_capture(reply) or board.gives_check(reply):
            tags.add("allowed_forcing_reply")
        if captured and PIECE_VALUE[captured.piece_type] >= 3:
            tags.add("allowed_piece_capture")
        board.push(reply)
        if board.is_checkmate():
            tags.add("allowed_immediate_mate")
    return tags


def motif_stats(rows: list[dict], ids: set[str], tag: str) -> tuple[int, int]:
    selected = [r for r in rows if r["game_id"] in ids and tag in motifs(r)]
    return len(selected), len({r["game_id"] for r in selected})


def pct(num: int, den: int) -> str:
    return f"{100 * num / den:.1f}%" if den else "—"


def main() -> None:
    positions = read_jsonl(ROOT / "output/positions.jsonl")
    base = read_jsonl(ROOT / "engine_output/base_100k.jsonl")
    deep = read_jsonl(ROOT / "engine_output/deep_500k.jsonl")
    split = json.loads((ROOT / "output/temporal_split.json").read_text())
    discovery, validation = set(split["discovery_150"]), set(split["validation_50"])
    games = {r["game_id"]: r for r in csv.DictReader((ROOT / "output/games.csv").open())}
    deep_by_key = {r["key"]: r for r in deep}

    confirmed = {
        "discovery": [r for r in deep if r["game_id"] in discovery and max(0, r.get("cp_loss_numeric") or 0) >= 120],
        "validation": [r for r in deep if r["game_id"] in validation and max(0, r.get("cp_loss_numeric") or 0) >= 120],
    }
    exposures = {
        "discovery": [p for p in positions if p["game_id"] in discovery],
        "validation": [p for p in positions if p["game_id"] in validation],
    }

    tags = [
        ("allowed_forcing_reply", "La respuesta forzada del rival quedó disponible"),
        ("allowed_piece_capture", "La línea principal permite capturar una pieza"),
        ("missed_forcing_move", "Había jaque o captura fuerte y se jugó una jugada no forzada"),
        ("bad_capture_choice", "La captura elegida fue costosa"),
        ("costly_quiet_pawn_move", "Movimiento tranquilo de peón en posición crítica"),
    ]
    motif_table = []
    for tag, label in tags:
        dn, dg = motif_stats(deep, discovery, tag)
        vn, vg = motif_stats(deep, validation, tag)
        motif_table.append({
            "tag": tag, "label": label,
            "discovery_positions": dn, "discovery_games": dg,
            "validation_positions": vn, "validation_games": vg,
            "discovery_share": dn / len(confirmed["discovery"]),
            "validation_share": vn / len(confirmed["validation"]),
        })

    phase_rows = []
    for phase in ["opening_proxy", "middlegame_proxy", "endgame_proxy"]:
        row = {"phase": phase}
        for block in ["discovery", "validation"]:
            exp = sum(p["phase_proxy"] == phase for p in exposures[block])
            err = sum(r["phase_proxy"] == phase for r in confirmed[block])
            row[f"{block}_exposure"] = exp
            row[f"{block}_confirmed"] = err
            row[f"{block}_per100"] = 100 * err / exp
        phase_rows.append(row)

    exercise_keys = [
        "595cee54-b44d-11f1-bb1f-e68c2101000f:40",
        "3fb7013d-acd7-11f1-bbdf-8eeeee01000f:122",
        "58df6243-b2b7-11f1-8acf-f45fe701000f:84",
        "d7d7d006-abd3-11f1-8acf-f45fe701000f:57",
        "2cd52b0b-b6a6-11f1-a51b-ebd42201000f:51",
    ]
    exercises = []
    for key in exercise_keys:
        r = deep_by_key[key]
        board = chess.Board(r["fen_before"])
        best_move = chess.Move.from_uci(r["best"]["first_move_uci"])
        exercises.append({
            "key": key,
            "game_id": r["game_id"],
            "game_url": games[r["game_id"]]["url"],
            "move_number": r["move_number"],
            "color": r["color"],
            "fen": r["fen_before"],
            "played": r["played_san"],
            "solution": board.san(best_move),
            "solution_line": san_line(r["fen_before"], r["best"]["pv_uci"]),
            "played_line": san_line(r["fen_before"], r["played"]["pv_uci"]),
            "loss_numeric": r["cp_loss_numeric"],
            "motifs": sorted(motifs(r)),
        })

    sample = []
    seen = set()
    for r in sorted(confirmed["discovery"], key=lambda x: -(max(0, x.get("cp_loss_numeric") or 0))):
        loss = max(0, r.get("cp_loss_numeric") or 0)
        if not 200 <= loss <= 1500 or not motifs(r) or r["game_id"] in seen:
            continue
        seen.add(r["game_id"])
        board = chess.Board(r["fen_before"])
        best_move = chess.Move.from_uci(r["best"]["first_move_uci"])
        sample.append({
            "key": r["key"], "game_id": r["game_id"], "move_number": r["move_number"],
            "color": r["color"], "played": r["played_san"], "best": board.san(best_move),
            "loss_numeric": loss, "motifs": sorted(motifs(r)), "game_url": games[r["game_id"]]["url"],
        })
        if len(sample) == 20:
            break

    summary = {
        "engine": json.loads((ROOT / "engine_output/deep_manifest.json").read_text()),
        "base_positions": len(base), "deep_positions": len(deep),
        "confirmed_threshold_numeric": 120,
        "confirmed": {k: {"positions": len(v), "games": len({r['game_id'] for r in v})} for k, v in confirmed.items()},
        "exposures": {k: len(v) for k, v in exposures.items()},
        "motifs": motif_table, "phases": phase_rows,
        "manual_review_sample": sample, "exercises": exercises,
        "limitations": [
            "The 800-position deep pass is a prioritized sample, so confirmed alerts per 100 decisions are lower bounds, not a complete error rate.",
            "Motifs are observable board events; they do not prove attention, calculation, or psychological causes.",
            "Mate scores use a separate mate field; the numeric field is only for ordering and threshold inclusion.",
        ],
    }
    (OUT / "review_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    (OUT / "exercises.json").write_text(json.dumps(exercises, indent=2, ensure_ascii=False) + "\n")

    with (OUT / "critical_positions.csv").open("w", newline="") as fh:
        fields = ["key", "block", "game_id", "move_number", "color", "phase", "played", "best_uci", "cp_loss_numeric", "motifs", "game_url", "fen"]
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for r in sorted(deep, key=lambda x: x["index"]):
            block = "discovery" if r["game_id"] in discovery else "validation"
            w.writerow({
                "key": r["key"], "block": block, "game_id": r["game_id"], "move_number": r["move_number"],
                "color": r["color"], "phase": r["phase_proxy"], "played": r["played_san"],
                "best_uci": r["best"]["first_move_uci"], "cp_loss_numeric": r["cp_loss_numeric"],
                "motifs": "|".join(sorted(motifs(r))), "game_url": games[r["game_id"]]["url"], "fen": r["fen_before"],
            })

    md = []
    md.append("# Review Fase 2 — primer perfil de errores recurrentes\n")
    md.append("**Jugador:** `cholmess21` · **Muestra congelada:** 200 partidas Rapid de 10+0 · **Motor:** Stockfish 19\n")
    md.append("## Conclusión ejecutiva\n")
    md.append("El primer patrón que merece entrenamiento no es una apertura concreta ni el reloj: es el **control de la respuesta forzada del rival antes de confirmar una jugada**. En el bloque de descubrimiento, 262 de 562 alertas confirmadas (46,6%) dejaron al rival una captura, jaque o secuencia forzada inmediata; el patrón reaparece en 85 de 168 (50,6%) en las 50 partidas reservadas. Dentro de ese grupo, la línea principal captura directamente una pieza en 118 posiciones de 77 partidas de descubrimiento y en 42 posiciones de 28 partidas de validación.\n")
    md.append("Dos manifestaciones acompañan el patrón: **no generar primero los jaques y capturas propios** y **elegir capturas sin verificar la recaptura o continuación**. Esto respalda una intervención común: un protocolo corto de candidatos y refutación, antes de estudiar repertorio adicional. La causa mental exacta sigue siendo una hipótesis; el tablero demuestra el evento repetido, no si proviene de atención, cálculo o impulso.\n")
    md.append("## Qué se analizó\n")
    md.append("- 7.729 decisiones propias recibieron dos análisis uniformes de 100.000 nodos: mejores alternativas y jugada realmente elegida.")
    md.append("- 800 posiciones prioritarias se reanalizaron a 500.000 nodos, con dos líneas independientes por posición.")
    md.append("- Resultado técnico: 7.729/7.729 y 800/800, sin errores; Threads=1, Hash=128 MB y hash del binario registrado.")
    md.append("- Descubrimiento: primeras 150 partidas y 5.858 decisiones. Validación temporal: últimas 50 y 1.871 decisiones.\n")
    md.append("El umbral operativo de este review es una pérdida profunda ≥120 en la escala numérica del motor. Las 800 posiciones fueron priorizadas antes del review; por eso las tasas por decisión son **pisos confirmados**, no un inventario exhaustivo.\n")
    md.append("## Patrones confirmados\n")
    md.append("| Motivo observable | Primeras 150: posiciones / partidas | Últimas 50: posiciones / partidas | % de alertas: descubrimiento → validación | Lectura |")
    md.append("| --- | ---: | ---: | ---: | --- |")
    readings = {
        "allowed_forcing_reply": "Patrón principal; alta recurrencia y estabilidad temporal.",
        "allowed_piece_capture": "Subgrupo más concreto del patrón principal.",
        "missed_forcing_move": "La generación de candidatos forzados propios es incompleta.",
        "bad_capture_choice": "Conviene verificar recapturas y la primera respuesta rival.",
        "costly_quiet_pawn_move": "Señal secundaria y solapada; no demuestra una debilidad de peones.",
    }
    for r in motif_table:
        md.append(f"| {r['label']} | {r['discovery_positions']} / {r['discovery_games']} | {r['validation_positions']} / {r['validation_games']} | {pct(r['discovery_positions'], len(confirmed['discovery']))} → {pct(r['validation_positions'], len(confirmed['validation']))} | {readings[r['tag']]} |")
    md.append("")
    md.append("### 1. No comprobar la primera respuesta forzada del rival — confianza alta\n")
    md.append("La evidencia no dice que 'no calculas'; dice algo más preciso: después de muchas jugadas elegidas, el rival dispone inmediatamente de una captura, jaque o secuencia forzada que empeora mucho la posición. La recurrencia aparece en 116 de 150 partidas de descubrimiento y 36 de 50 del holdout.\n")
    md.append("**Hipótesis pedagógica (confianza media):** el proceso de decisión se detiene al encontrar una jugada plausible y no ejecuta siempre una última prueba de refutación desde el punto de vista rival.\n")
    md.append("### 2. No generar primero las jugadas forzadas propias — confianza media-alta\n")
    md.append("En 88 posiciones de 55 partidas iniciales había una captura o jaque fuerte y se escogió una jugada no forzada; reaparece 34 veces en 18 partidas de validación. No significa que toda captura sea buena: significa que jaques y capturas deben entrar sistemáticamente al conjunto de candidatos antes de comparar planes tranquilos.\n")
    md.append("### 3. Capturar antes de verificar la continuación — confianza media-alta\n")
    md.append("Las capturas costosas aparecen en 106 posiciones de 78 partidas iniciales y en 22 posiciones de 18 partidas de validación. Varios ejemplos no son combinaciones largas: la captura entrega la pieza, permite una recaptura o abandona una amenaza más importante.\n")
    md.append("## Dónde ocurre\n")
    md.append("| Fase proxy | Descubrimiento: alertas / decisiones (por 100) | Validación: alertas / decisiones (por 100) |")
    md.append("| --- | ---: | ---: |")
    phase_name = {"opening_proxy": "Apertura", "middlegame_proxy": "Medio juego", "endgame_proxy": "Final"}
    for r in phase_rows:
        md.append(f"| {phase_name[r['phase']]} | {r['discovery_confirmed']} / {r['discovery_exposure']} ({r['discovery_per100']:.2f}) | {r['validation_confirmed']} / {r['validation_exposure']} ({r['validation_per100']:.2f}) |")
    md.append("")
    md.append("El medio juego concentra la tasa confirmada más alta y se mantiene en validación. Esto hace que el primer módulo sea táctico-decisional y no una clase de aperturas. El reloj tampoco es un diagnóstico defendible: solo 18 decisiones de una partida se observaron con ≤60 segundos.\n")
    md.append("## Primera microlección: CCT + refutación\n")
    md.append("Antes de jugar, usa siempre esta secuencia de 20–30 segundos en posiciones no triviales:\n")
    md.append("1. **Jaque:** ¿tengo algún jaque útil? ¿Qué jaque tiene el rival después de mi candidato?")
    md.append("2. **Captura:** ¿qué puedo capturar? Si capturo, ¿cuál es la recaptura y qué queda atacado?")
    md.append("3. **Amenaza:** ¿cuál es la amenaza más fuerte de ambos lados?")
    md.append("4. **Refutación:** imagina que el rival conoce tu idea. Busca su respuesta más desagradable, no la más natural.")
    md.append("5. Solo entonces confirma la jugada. En este nivel, una línea corta y hostil de 1–2 respuestas tiene más valor que calcular una variante bonita de seis jugadas.\n")
    md.append("## Cinco ejercicios de tus propias partidas\n")
    md.append("En cada FEN te toca mover con el color indicado. Antes de mirar la solución, escribe: jaques propios, capturas propias y la mejor respuesta forzada del rival a tu primera candidata.\n")
    for i, ex in enumerate(exercises, 1):
        suffix = "." if ex["color"] == "white" else "..."
        md.append(f"### Ejercicio {i} — {ex['color']} juega, movimiento {ex['move_number']}{suffix}\n")
        md.append(f"FEN: `{ex['fen']}`  ")
        md.append(f"[Partida completa]({ex['game_url']})\n")
        md.append(f"En la partida jugaste **{ex['played']}**. Encuentra una alternativa que supere la prueba CCT + refutación.  ")
        md.append(f"**Solución:** **{ex['solution']}**. Línea de referencia: `{ex['solution_line']}`. La línea tras la jugada real comienza `{ex['played_line']}`.\n")
    md.append("## Qué todavía no sabemos\n")
    md.append("- No sabemos si la causa es atención, visualización, cálculo, evaluación o hábito; eso requiere tus respuestas a ejercicios y nuevas partidas.")
    md.append("- No hay base para afirmar un problema principal de reloj, una apertura específica o técnica de final aislada.")
    md.append("- La siguiente medición debe observar transferencia: menos respuestas forzadas omitidas en partidas nuevas, no solo acertar estos cinco ejercicios.\n")
    md.append("## Decisión, entregable y siguiente paso\n")
    md.append("**Decisión:** el primer tema del coach será *CCT + refutación del rival*, con capturas como submódulo.  ")
    md.append("**Entregable:** review reproducible, tabla de 800 posiciones, muestra revisada y cinco ejercicios propios.  ")
    md.append("**Siguiente paso:** resolver los cinco ejercicios sin motor y registrar tu razonamiento. Con esas respuestas distinguiremos entre fallo de generación de candidatos y fallo de verificación, y adaptaremos la segunda microlección.")

    report = "\n".join(md) + "\n"
    report_path = OUT / "Chess-ML-Coach-Review-Fase-2.md"
    report_path.write_text(report)

    hashes = {}
    for path in sorted(OUT.iterdir()):
        if path.is_file():
            hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    (OUT / "SHA256SUMS.json").write_text(json.dumps(hashes, indent=2) + "\n")
    print(json.dumps({"report": str(report_path), "files": sorted(p.name for p in OUT.iterdir()), "summary": summary["confirmed"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
