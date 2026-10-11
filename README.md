# MoveMirror

**The chess coach that learns how you play.**

MVP privado local: ciclo **partidas → patrón → microlección → ejercicios → razonamiento → perfil → siguiente ejercicio**, centrado en **CCT + comprobación de la respuesta forzada del rival**.

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

## MoveMirror v0.5 — Import Hub

Desacopla la **adquisición de partidas** del coaching y la transferencia.

- Rutas: `/import`, `/import/manual`, `/games`, `/games/:id`
- Fuentes: Chess.com, Lichess, archivos PGN, PGN pegado, entrada manual
- Modelo canónico `canonical-game-v1`, deduplicación `game-fingerprint-v1`, merge `metadata-merge-v1`
- Identidad local configurable en **Perfil → Identidad del jugador** y `data/games/player-identity.json` (semilla histórica `cholmess21`, no hardcodeada en importación)
- API: `GET/PATCH /api/player-identity`, `POST /api/player-identity/reconcile` (solo unresolved/probable; no toca confirmaciones manuales ni cohortes congeladas)
- Importar **no** añade partidas automáticamente al coaching ni a cohortes congeladas
- Política de coaching productiva actual: `rapid-10m-coaching-v1` (10+0 exacto, identidad verificada, partida finalizada)

```bash
npm run games:migrate   # migración histórica (idempotente)
npm run games:verify    # integridad de índices y fingerprints
npm run games:reindex
npm run games:export
npm run test:e2e        # incluye e2e/import-hub.spec.ts
```

Reportes de migración: `data/games/migration-v0.5.0.json` y `.md`.

## MoveMirror v0.5.1 — Idiomas (es / en / de)

Interfaz en **español**, **inglés** y **alemán** con copy en lenguaje claro. Los detalles técnicos (FEN, UCI, enums internos) van en **Detalles técnicos**, no en el flujo principal.

- **Idiomas:** `es`, `en`, `de` — preferencia en `localStorage` (`move-mirror-locale-v1`).
- **Fallback:** inglés (`en`) si falta una clave.
- **Archivos autoritativos:** `src/i18n/locales/es/` y `src/i18n/locales/de/` (no se sobrescriben al sincronizar).
- **`npm run i18n:sync`** — añade solo claves nuevas desde `en`, marca `⟪pending⟫`; nunca pisa traducciones existentes.
- **`npm run i18n:check`** — paridad de claves, cero pending, cero inglés de UI no permitido (whitelist estricta por clave/valor).
- Guías: `docs/ui-language-guide.md`, `docs/plain-language-glossary.md`.

Los ritmos de juego (`bullet`, `blitz`, `rapid`, …) son códigos internos; la UI usa `formatTimeControl()` (p. ej. Rapid → Rápidas / Schnellschach).

## MoveMirror v0.3 — Transfer Loop

Ciclo: **entrenar → sincronizar partidas 10+0 nuevas → medir transferencia → actualizar el canal de partidas reales → adaptar la enseñanza**.

- Vista `/transfer` y resumen en el Dashboard.
- Baseline congelado: las 200 partidas de Fase 2. El corte sale de `data/transfer/baseline-manifest.json` (no se duplica en el código).
- Detector `allowed-forcing-reply-transfer-v1`: decisión propia, pérdida ≥ 120 con el presupuesto fijo (80k, y 500k solo para confirmar la banda 105–135 u otras inestabilidades), y la respuesta principal del rival es captura, jaque o mate. El subgrupo de captura de pieza (valor ≥ 3) va aparte.
- El baseline se recalcula con ese mismo presupuesto. No se comparan las 800 posiciones priorizadas del review.
- Incertidumbre por bootstrap de partidas, no de jugadas sueltas.
- Los ejercicios no reciben α/β desde las partidas.

```bash
npm run transfer:manifest    # corte desde games.csv, si el manifiesto no existe
npm run transfer:baseline    # reanaliza el baseline; STOCKFISH_PATH si hace falta
npm run transfer:sync        # partidas nuevas de cholmess21
npm run dev                  # luego abre /transfer
```

Modo offline, sin red: en `/transfer`, «Modo offline (fixtures)».

## MoveMirror v0.6.1 — Personal Validation Ledger

- **Canonical evidence** (dose, qualification, snapshots): `data/validation/` on the engine server (`events.jsonl`, `state.json`, `snapshots/`, `exports/`, `migrations/`).
- **Browser `localStorage`** remains a UI cache; training sync posts pedagogy mirrors to `POST /api/validation/sync` and one-time `POST /api/validation/migrate`.
- Dose math is unchanged: `shared/transfer/intervention.js` (`cct-refutation-dose-v1`); the ledger does not duplicate rules.
- Integrity: `npm run validation:verify` · export: `npm run validation:export` · docs: [docs/personal-validation-ledger.md](docs/personal-validation-ledger.md)

## MoveMirror v0.2.1 — Evaluation Hardening

- Escalamiento automático 80k → 500k cerca de umbrales (35–65 cp, 105–135 cp), mates inestables e información incompleta.
- Cache persistente en `data/engine-cache/` (invalidación por hash/presupuesto/criterio).
- Cola FIFO Stockfish, timeout, cancelación al cerrar request, reinicio si el motor muere.
- Limpiar cache: `npm run cache:clear-engine`
- E2E no-spoiler: `npm run test:e2e` (UX; la solución puede seguir en el bundle JS).

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
| `/transfer` | Cohortes, comparación y recomendación |
| `/import` | Import Hub (Chess.com, Lichess, PGN, manual) |
| `/import/manual` | Tablero para registrar partidas |
| `/games` | Biblioteca de partidas canónicas |

| Código | Rol |
|--------|-----|
| `src/data/` | Patrón, habilidades, ejercicios, lección |
| `src/domain/` | Evaluación, perfil (Beta), selección adaptativa |
| `src/storage/` | Persistencia local |
| `src/contracts/future.ts` | Contratos Defense Lab, Sparring, sync, etc. |

## Versiones de contenido

- Lección: `cct-refutation-v1`
- Criterio de evaluación: `engine-validated-v2`

## Limitaciones (v0.5)

- Un jugador local (sin cuentas ni multiusuario). OCR/PDF de planillas queda para v0.5.1.
- Un patrón pedagógico productivo principal (10+0). Otras categorías de tiempo se almacenan pero no se mezclan automáticamente.
- v0.3/v0.5 no enseña una debilidad nueva automáticamente; solo puede proponer revisarla.
- La comparación no afirma que MoveMirror haya causado el cambio.
- El modo offline usa análisis escrito en los fixtures, no Stockfish.
- Hace falta Stockfish local para el baseline y para las partidas reales.
- Sin Defense Lab, Sparring Agent, modelo nuevo, cuentas ni despliegue público.

## Siguiente incremento recomendado

1. Cuando la cohorte congelada tenga volumen, revisar a mano el subgrupo de captura de pieza antes de convertirlo en lección.
2. Dejar que los ejercicios futuros aceptados entren al entrenador con el mismo criterio `engine-validated-v2`.
3. Repetir el bucle con la siguiente cohorte, sin reabrir la anterior.
