# Review Fase 2 — primer perfil de errores recurrentes

**Jugador:** `cholmess21` · **Muestra congelada:** 200 partidas Rapid de 10+0 · **Motor:** Stockfish 19

## Conclusión ejecutiva

El primer patrón que merece entrenamiento no es una apertura concreta ni el reloj: es el **control de la respuesta forzada del rival antes de confirmar una jugada**. En el bloque de descubrimiento, 262 de 562 alertas confirmadas (46,6%) dejaron al rival una captura, jaque o secuencia forzada inmediata; el patrón reaparece en 85 de 168 (50,6%) en las 50 partidas reservadas. Dentro de ese grupo, la línea principal captura directamente una pieza en 118 posiciones de 77 partidas de descubrimiento y en 42 posiciones de 28 partidas de validación.

Dos manifestaciones acompañan el patrón: **no generar primero los jaques y capturas propios** y **elegir capturas sin verificar la recaptura o continuación**. Esto respalda una intervención común: un protocolo corto de candidatos y refutación, antes de estudiar repertorio adicional. La causa mental exacta sigue siendo una hipótesis; el tablero demuestra el evento repetido, no si proviene de atención, cálculo o impulso.

## Qué se analizó

- 7.729 decisiones propias recibieron dos análisis uniformes de 100.000 nodos: mejores alternativas y jugada realmente elegida.
- 800 posiciones prioritarias se reanalizaron a 500.000 nodos, con dos líneas independientes por posición.
- Resultado técnico: 7.729/7.729 y 800/800, sin errores; Threads=1, Hash=128 MB y hash del binario registrado.
- Descubrimiento: primeras 150 partidas y 5.858 decisiones. Validación temporal: últimas 50 y 1.871 decisiones.

El umbral operativo de este review es una pérdida profunda ≥120 en la escala numérica del motor. Las 800 posiciones fueron priorizadas antes del review; por eso las tasas por decisión son **pisos confirmados**, no un inventario exhaustivo.

## Patrones confirmados

| Motivo observable | Primeras 150: posiciones / partidas | Últimas 50: posiciones / partidas | % de alertas: descubrimiento → validación | Lectura |
| --- | ---: | ---: | ---: | --- |
| La respuesta forzada del rival quedó disponible | 262 / 116 | 85 / 36 | 46.6% → 50.6% | Patrón principal; alta recurrencia y estabilidad temporal. |
| La línea principal permite capturar una pieza | 118 / 77 | 42 / 28 | 21.0% → 25.0% | Subgrupo más concreto del patrón principal. |
| Había jaque o captura fuerte y se jugó una jugada no forzada | 88 / 55 | 34 / 18 | 15.7% → 20.2% | La generación de candidatos forzados propios es incompleta. |
| La captura elegida fue costosa | 106 / 78 | 22 / 18 | 18.9% → 13.1% | Conviene verificar recapturas y la primera respuesta rival. |
| Movimiento tranquilo de peón en posición crítica | 114 / 72 | 29 / 17 | 20.3% → 17.3% | Señal secundaria y solapada; no demuestra una debilidad de peones. |

### 1. No comprobar la primera respuesta forzada del rival — confianza alta

La evidencia no dice que 'no calculas'; dice algo más preciso: después de muchas jugadas elegidas, el rival dispone inmediatamente de una captura, jaque o secuencia forzada que empeora mucho la posición. La recurrencia aparece en 116 de 150 partidas de descubrimiento y 36 de 50 del holdout.

**Hipótesis pedagógica (confianza media):** el proceso de decisión se detiene al encontrar una jugada plausible y no ejecuta siempre una última prueba de refutación desde el punto de vista rival.

### 2. No generar primero las jugadas forzadas propias — confianza media-alta

En 88 posiciones de 55 partidas iniciales había una captura o jaque fuerte y se escogió una jugada no forzada; reaparece 34 veces en 18 partidas de validación. No significa que toda captura sea buena: significa que jaques y capturas deben entrar sistemáticamente al conjunto de candidatos antes de comparar planes tranquilos.

### 3. Capturar antes de verificar la continuación — confianza media-alta

Las capturas costosas aparecen en 106 posiciones de 78 partidas iniciales y en 22 posiciones de 18 partidas de validación. Varios ejemplos no son combinaciones largas: la captura entrega la pieza, permite una recaptura o abandona una amenaza más importante.

## Dónde ocurre

| Fase proxy | Descubrimiento: alertas / decisiones (por 100) | Validación: alertas / decisiones (por 100) |
| --- | ---: | ---: |
| Apertura | 52 / 1497 (3.47) | 23 / 498 (4.62) |
| Medio juego | 402 / 3148 (12.77) | 101 / 891 (11.34) |
| Final | 108 / 1213 (8.90) | 44 / 482 (9.13) |

El medio juego concentra la tasa confirmada más alta y se mantiene en validación. Esto hace que el primer módulo sea táctico-decisional y no una clase de aperturas. El reloj tampoco es un diagnóstico defendible: solo 18 decisiones de una partida se observaron con ≤60 segundos.

## Primera microlección: CCT + refutación

Antes de jugar, usa siempre esta secuencia de 20–30 segundos en posiciones no triviales:

1. **Jaque:** ¿tengo algún jaque útil? ¿Qué jaque tiene el rival después de mi candidato?
2. **Captura:** ¿qué puedo capturar? Si capturo, ¿cuál es la recaptura y qué queda atacado?
3. **Amenaza:** ¿cuál es la amenaza más fuerte de ambos lados?
4. **Refutación:** imagina que el rival conoce tu idea. Busca su respuesta más desagradable, no la más natural.
5. Solo entonces confirma la jugada. En este nivel, una línea corta y hostil de 1–2 respuestas tiene más valor que calcular una variante bonita de seis jugadas.

## Cinco ejercicios de tus propias partidas

En cada FEN te toca mover con el color indicado. Antes de mirar la solución, escribe: jaques propios, capturas propias y la mejor respuesta forzada del rival a tu primera candidata.

### Ejercicio 1 — black juega, movimiento 20...

FEN: `r4rk1/2p1n1p1/3p3p/1pb1p2P/p3Pq2/P1P2N2/RP3PPN/3Q1RK1 b - - 0 20`  
[Partida completa](https://www.chess.com/game/live/184070622900)

En la partida jugaste **Qg4**. Encuentra una alternativa que supere la prueba CCT + refutación.  
**Solución:** **Qxe4**. Línea de referencia: `Qxe4 Ra1 Rab8 g3 Rf5 b4 axb3 Qxb3+`. La línea tras la jugada real comienza `Qg4 Nxg4 g5 Ngh2 Kg7 Qe2`.

### Ejercicio 2 — black juega, movimiento 61...

FEN: `8/1k6/8/pP6/P7/2R4r/2K5/8 b - - 0 61`  
[Partida completa](https://www.chess.com/game/live/174256061220)

En la partida jugaste **Rxc3+**. Encuentra una alternativa que supere la prueba CCT + refutación.  
**Solución:** **Rh4**. Línea de referencia: `Rh4 Kb3 Rb4+ Ka3 Rh4`. La línea tras la jugada real comienza `Rxc3+ Kxc3`.

### Ejercicio 3 — black juega, movimiento 42...

FEN: `5R2/1r1q3k/6pp/3p4/p1n5/6B1/P4QPP/6K1 b - - 1 42`  
[Partida completa](https://www.chess.com/game/live/183971526340)

En la partida jugaste **d4**. Encuentra una alternativa que supere la prueba CCT + refutación.  
**Solución:** **Rb1+**. Línea de referencia: `Rb1+ Qf1 Rxf1+ Rxf1 d4 Bh4 d3 Bf6`. La línea tras la jugada real comienza `d4 Qf6`.

### Ejercicio 4 — white juega, movimiento 29.

FEN: `1k4r1/1p4r1/p1p5/4N3/4P3/1PPPb2P/1P4P1/R4R1K w - - 1 29`  
[Partida completa](https://www.chess.com/game/live/174197859140)

En la partida jugaste **Ng4**. Encuentra una alternativa que supere la prueba CCT + refutación.  
**Solución:** **g4**. Línea de referencia: `g4 Rg5 Nf3 Rb5 Rae1 Bb6 Re2 a5`. La línea tras la jugada real comienza `Ng4 Rxg4`.

### Ejercicio 5 — white juega, movimiento 26.

FEN: `r1b5/1p4pk/p1pp2qp/P3pr2/1P2Q2b/1B1PB2P/2P2PP1/3R1RK1 w - - 4 26`  
[Partida completa](https://www.chess.com/game/live/184215932040)

En la partida jugaste **Kh2**. Encuentra una alternativa que supere la prueba CCT + refutación.  
**Solución:** **Qxh4**. Línea de referencia: `Qxh4 Bd7 Qg4 Qf6 Qg3 d5 Qh2`. La línea tras la jugada real comienza `Kh2 Bg5`.

## Qué todavía no sabemos

- No sabemos si la causa es atención, visualización, cálculo, evaluación o hábito; eso requiere tus respuestas a ejercicios y nuevas partidas.
- No hay base para afirmar un problema principal de reloj, una apertura específica o técnica de final aislada.
- La siguiente medición debe observar transferencia: menos respuestas forzadas omitidas en partidas nuevas, no solo acertar estos cinco ejercicios.

## Decisión, entregable y siguiente paso

**Decisión:** el primer tema del coach será *CCT + refutación del rival*, con capturas como submódulo.  
**Entregable:** review reproducible, tabla de 800 posiciones, muestra revisada y cinco ejercicios propios.  
**Siguiente paso:** resolver los cinco ejercicios sin motor y registrar tu razonamiento. Con esas respuestas distinguiremos entre fallo de generación de candidatos y fallo de verificación, y adaptaremos la segunda microlección.
