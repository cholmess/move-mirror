# MoveMirror

**The chess coach that learns how you play.**

MVP privado para `cholmess21`: ciclo **partidas → patrón → microlección → ejercicios → razonamiento → perfil → siguiente ejercicio**, centrado en **CCT + comprobación de la respuesta forzada del rival**.

Fuentes: `Chess-ML-Coach-Fase-2-Reproducible.zip` (extraído en `data/fase-2/`), review y visión en los `.md` del repo.

### Datos Fase 2

```bash
# 1) Extraer zip (una vez)
unzip -o Chess-ML-Coach-Fase-2-Reproducible.zip -d data/fase-2

# 2) Regenerar JSON de la app desde review_output
npm run sync:fase2
```

Genera `src/data/generated/`:

- `exercises.core.json` — 5 ejercicios de `exercises.json`
- `exercises.pool.json` — posiciones CSV con motivo `allowed_forcing_reply` (344; excluye duplicados del núcleo)
- `manifest.json` — conteos y filtros

Variable opcional: `POOL_LIMIT=100 npm run sync:fase2`

## Requisitos

- Node.js 18+
- npm

## MoveMirror v0.2 — Pedagogical Integrity

- Criterio de evaluación: **`engine-validated-v2`** (servicio Stockfish local, no WASM).
- Estados: `verified_best`, `verified_acceptable`, `playable_inexact`, `incorrect`, `unverified`, `illegal`.
- Solo evaluaciones verificadas (excepto `unverified`/`illegal`) actualizan α/β.
- Migración automática desde `move-mirror-state-v1` → `move-mirror-state-v2` (backup en `move-mirror-state-v1-backup`).

### Stockfish local

```bash
export STOCKFISH_PATH=/ruta/a/stockfish   # macOS: brew install stockfish
export ENGINE_PORT=8787                   # opcional
npm run dev                               # Vite + servicio engine
```

- Presupuesto: **80k nodos × 2** por jugada (`nodes-80k-v1`), Threads=1, Hash=128 MB.
- Si el motor no arranca: las jugadas legales quedan **`unverified`** y se muestra *«La jugada es legal, pero todavía no ha sido verificada»*.
- Health: `http://127.0.0.1:8787/health`

Solo frontend (sin verificación): `npm run dev:web`

## Abrir la app

```bash
cd /Users/christopherholmes/Documents/Projects/move-mirror
npm install
npm run dev
```

Abre **http://localhost:5173** (proxy `/api` → engine en dev).

Build de producción:

```bash
npm run build
npm run preview
```

## Pruebas

```bash
npm test
```

## Persistencia

El progreso (intentos, perfil bayesiano, lección completada, selección adaptativa) se guarda en **localStorage** del navegador (`move-mirror-state-v1`). Cierra y vuelve a abrir la pestaña para comprobar que no se pierde.

Exporta intentos desde **Perfil → Exportar intentos (JSON)**.

## Estructura

| Ruta | Función |
|------|---------|
| `/` | Dashboard personal |
| `/lesson` | Microlección CCT (5 pasos, FEN reales) |
| `/train` | Tablero interactivo + registro CCT |
| `/profile` | Perfil vivo + log |

| Código | Rol |
|--------|-----|
| `src/data/` | Patrón, habilidades, ejercicios, lección |
| `src/domain/` | Evaluación, perfil (Beta), selección adaptativa |
| `src/storage/` | Persistencia local |
| `src/contracts/future.ts` | Contratos Defense Lab, Sparring, sync, etc. |

## Versiones de contenido

- Lección: `cct-refutation-v1`
- Criterio de evaluación: `engine-validated-v2`

## Limitaciones (MVP)

- Sin Stockfish en cliente; no se validan alternativas tácticas distintas de la solución del review.
- Sin sync Chess.com ni generación automática de ejercicios.
- Un solo jugador (`cholmess21`) y un patrón confirmado.
- Ejercicios **ampliados** (CSV): mejor jugada UCI→SAN; sin línea de referencia completa en feedback.
- Detección de “respuesta forzada del rival” en texto es heurística.

## Siguiente incremento recomendado

1. Enriquecer el pool con líneas SAN desde `data/fase-2/engine_output/deep_500k.jsonl`.
2. Añadir evaluación ligera con motor WASM para alternativas legales.
3. Backend opcional (SQLite) para multi-dispositivo y sync Chess.com según `GameSyncService`.
