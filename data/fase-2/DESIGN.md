# Pipeline Fase 1 — contrato y decisiones

## Alcance del primer entregable

Ingesta real + selección reproducible + diagnóstico descriptivo. La taxonomía de errores queda como esquema a contrastar. Motor, causas pedagógicas y lecciones se incorporan después; ninguna etiqueta de contexto actual identifica una debilidad.

## Flujo

1. **Configurar:** usuario, corte UTC, 600 segundos exactos, ajedrez estándar, N=200, reglas versionadas de longitud y terminación.
2. **Obtener:** `GET /pub/player/cholmess21/games/archives`; descargar meses completos con `/games/YYYY/MM` en orden inverso. Usar JSON porque conserva resultado específico, ratings, rated, ID, FEN y PGN. No hace falta login ni token.
3. **Congelar:** bytes originales por respuesta, URL, hora de descarga, headers HTTP (ETag, Last-Modified, Date, Cache-Control cuando existan), hash SHA-256 y versiones. Archivo del mes actual solo contiene partidas terminadas públicas disponibles.
4. **Auditar:** deduplicar por UUID, después URL. Si un mismo ID tiene payloads diferentes, detener y revisar. Mantener motivos múltiples y banderas de calidad.
5. **Validar:** usuario en exactamente un color, control exacto, variante estándar, end_time al corte, PGN parseable y sin errores, nombres/TimeControl/Result coherentes con JSON, token terminal de resultado, posición inicial estándar, jugadas legales y FEN final coincidente si existe. Un mate o ahogado declarado debe existir en el tablero. Un PGN ausente/truncado no se convierte en partida válida por ignorar errores del parser.
6. **Filtrar:** excluir 0–8 medias jugadas. Excluir 9–20 medias jugadas si cualquiera de los dos terminó `resigned` o `abandoned`. Guardar todas las exclusiones; se usan para calidad/contexto de comportamiento, no para inferir debilidades ajedrecísticas. No excluir automáticamente una derrota posterior por tiempo o abandono: debe analizarse la posición previa para conocer su componente ajedrecístico.
7. **Seleccionar:** ordenar globalmente `(end_time, game_id)` descendente después de validar/deduplicar. Tomar 200, nunca las primeras 200 descargadas sin filtrar. Un empate de segundo se resuelve por ID lexicográfico, sin afirmar un orden real subsegundo. Si faltan elegibles, retroceder otro mes; si se agota historial o falla un mes, detener sin afirmar muestra completa.
8. **Normalizar:** partidas y decisiones propias, con unión por game_id. Entregar juegos cronológicos, PGN intacto, auditoría, tablas y JSONL de posiciones.
9. **Describir:** resultados por color, aperturas por color + ECO, duración de pared, forma de término, rating observado, cobertura de reloj y contextos. Mostrar denominadores, tamaños de grupo y límites.
10. **Verificar:** reconstruir offline y exigir hashes idénticos de salidas. Los raw nunca se vuelven a descargar para “reproducir”.

## Heurísticas explícitas

“Abandono temprano” no tiene un umbral ajedrecístico universal. El default de 10 movimientos numerados aproxima una regla conservadora del brief. También aparta rendiciones tácticas legítimas, incluso victorias del usuario; se muestra sensibilidad con 4, 5, 10 y 15 movimientos (8/10/20/30 medias jugadas) sobre los mismos meses. Mates de más de cuatro movimientos permanecen. Rated no es filtro del brief; se conserva y segmenta. Esta corrida terminó conteniendo solo partidas rated.

El `abandoned` oficial dice que una partida terminó por abandono; no describe motivación, fallo técnico ni situación del tablero. `resigned` tampoco significa error temprano por sí solo. Los resultados se describen, sin deducir causas.

Los relojes de los mismos colores se restan consecutivamente, con 600 s como inicio de cada jugador. Si falta un reloj, no se interpola un tiempo por jugada desde el siguiente. Un aumento o valor fuera de rango queda marcado, sin atribuir apuro. El reloj previo del propio turno no incorpora la espera del rival. La última anotación no es el reloj de terminación si no hubo otra jugada.

La fase es un proxy material, versionado y revisable. Las etiquetas “respuesta a jaque”, “captura jugada”, “jaque jugado”, “promoción”, “material reducido” y “≤60 s antes de jugar” ayudan a organizar posiciones para inspección; ninguna presupone que esa decisión sea crítica ni errónea.

## Contratos de datos

| Nivel | Campos principales | Uso |
| --- | --- | --- |
| Fuente | URL, bytes, headers, SHA-256, fetched_at_utc | Evidencia de lo recibido |
| Auditoría | game_id, source, end_time, razones, flags, status | Seleccionada / excluida / elegible más antigua |
| Partida | color, resultado propio/rival, término, rated, rating API posterior, rating PGN, ECO, plies, duración | Descriptivos y contexto |
| Decisión | game_id, ply, FEN antes, SAN/UCI elegida, movimientos legales, relojes, fase proxy | Unidad futura de análisis ajedrecístico |
| Motor (pendiente) | binario/hash, NNUE/hash, opciones, nodos, profundidad, score POV propio, PV, alternativa elegida | Evidencia objetiva reproducible |
| Pedagogía (pendiente) | candidatos, ejemplos, exposición, recurrencia entre partidas, confianza, validación temporal | Hipótesis sobre habilidades |

Ratings: la documentación define el JSON mensual como rating posterior al juego. Guardar `rating_api_post` y `rating_pgn` separados; no mezclar ni afirmar automáticamente que PGN es rating previo garantizado. Para ajuste futuro por fuerza del rival, usar observación previa si se puede reconstruir con suficiente historia. No usar cambios posteriores como variable causal.

No imputar aperturas/rating/relojes ausentes. Accuracy calculada por Chess.com es opcional y depende de que la partida haya sido analizada; se conserva sin usarla como comparación uniforme. No se descargan chats ni datos privados.

## Motor en la siguiente etapa

Analizar todas las decisiones propias de las 200 partidas: analizar solo derrotas o posiciones con grandes cambios produciría sesgo de selección. Comenzar con presupuesto fijo de 100.000 nodos/posición, Threads=1, Hash=128 MB, hash table reiniciada por análisis y misma versión/red de Stockfish. Registrar arquitectura y opciones; nodos fijos favorecen comparación, pero no garantizan bytes idénticos entre plataformas.

Para cada posición anterior a una decisión, obtener dos alternativas (MultiPV=2 si hay al menos dos jugadas legales) y evaluación de la jugada elegida con `root_moves=[played_move]`. Revaluar con 500.000 nodos posiciones candidatas junto a sus alternativas. Guardar evaluaciones desde la perspectiva del jugador, mates separados y profundidad real. Una evaluación después de la jugada debe convertirse al mismo POV antes de compararse; mezclar POV invierte el significado de una pérdida.

La pérdida exploratoria de centipeones es `score_best - score_played` con evaluaciones comparables, no “score_after - score_before” sin cambiar perspectiva. Puede ser inestable con presupuesto bajo; no truncar anomalías negativas sin registrarlas. En posiciones ya ganadas/perdidas, una variación grande de cp puede ser pedagógicamente irrelevante. Usar oportunidades, cambio de estado y claridad de alternativas además de cp.

Taxonomía: táctica / cálculo / apertura / estrategia / final / evaluación / tiempo. Separar **motivo observable** de **causa probable**. Un caballo colgado puede resultar de cálculo, atención, reloj o evaluación; el tablero no resuelve esa causa por sí solo. Etiquetas multiatributo, sin forzar categorías mutuamente excluyentes. No entrenar clasificador sin ejemplos revisados y línea base transparente.

## Experimento de menor tamaño

Primero mapa de oportunidades por contexto de las primeras 150 partidas; revisar 15–20 posiciones de partidas distintas y añadir una muestra aleatoria de decisiones sin alertas para detectar lo que las heurísticas omiten. Para hablar de recurrencia, exigir varios ejemplos independientes, informar por 100 oportunidades comparables y distinguir partidas de sesiones (sesión = regla temporal fijada después, por ejemplo gap >30 min, no inferida ahora).

Congelar candidatos/criterios antes de inspeccionar ajedrecísticamente las últimas 50. Los resultados descriptivos de ese bloque son visibles, pero ningún ejercicio ni ajuste pedagógico se hará con sus posiciones. Reservar también partidas nuevas para medir transferencia tras las lecciones; un holdout de esta muestra no demuestra mejora por enseñanza.

## Criterios de aceptación del primer entregable

- 200 IDs únicos exactamente, controles `600`, posiciones legales y coherencia de resultados.
- Ningún mes omitido dentro del tramo revisado.
- Cada registro revisado aparece en auditoría; partidas más antiguas elegibles no figuran como excluidas.
- Numeradores y denominadores por color y término suman el total.
- PGN de salida permite reconstruir las mismas decisiones.
- Presencia/ausencia de reloj no equivale a presión/no presión.
- Replay offline valida SHA de fuentes, mismos IDs y hashes de todas las salidas.
- Ninguna causa pedagógica ni debilidad asignada en este primer diagnóstico.

Fuentes: [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api) y [python-chess PGN parsing](https://python-chess.readthedocs.io/en/latest/pgn.html). Las reglas de selección y exposición son decisiones del proyecto, no recomendaciones oficiales de Chess.com.
