# Chess ML Coach

## Visión

Construir un coach de ajedrez verdaderamente personalizado a partir de las partidas del jugador. No será otro analizador que enumera errores del motor: mantendrá un modelo vivo de cómo juega la persona, descubrirá patrones recurrentes, escogerá qué debería aprender después y generará lecciones y ejercicios ad hoc usando posiciones de sus propias partidas.

## Promesa del producto

Después de cada sesión, el coach debe poder responder:

1. ¿Qué errores se repiten y cuáles son incidentes aislados?
2. ¿Cuál es la causa probable: cálculo, concepto, apertura, gestión del tiempo, evaluación o técnica?
3. ¿Qué tema tiene mayor valor pedagógico ahora?
4. ¿Cómo se enseña ese tema con ejemplos comprensibles para este jugador?
5. ¿Qué ejercicios verifican que realmente lo aprendió?
6. ¿El patrón mejoró en partidas posteriores?

## Diferencia frente a un analizador de partidas

| Analizador convencional | Chess ML Coach |
|---|---|
| Evalúa una partida | Aprende de todo el historial |
| Marca blunders y mejores jugadas | Identifica hábitos y causas recurrentes |
| Sigue la evaluación del motor | Combina motor, contexto y perfil del jugador |
| Entrega comentarios genéricos | Crea lecciones ad hoc en el nivel adecuado |
| Termina al cerrar el análisis | Sigue el progreso y adapta el currículo |

## Dos modelos complementarios

### 1. Modelo del jugador

Estima cómo tiende a decidir el jugador en cada tipo de posición. Sus señales incluyen:

- posición y jugadas legales;
- color, rating y control de tiempo;
- tiempo restante y tiempo consumido, cuando esté disponible;
- fase de la partida;
- estructura de peones, seguridad del rey, material e iniciativa;
- historial reciente y familiaridad con la apertura;
- dificultad objetiva de la decisión.

No buscamos solamente predecir la siguiente jugada. Buscamos reconocer tendencias: sobrevalorar ataques, no buscar jugadas forzadas, cambiar piezas equivocadamente, apurarse en posiciones críticas, fallar finales específicos o repetir decisiones subóptimas bajo presión.

### 2. Modelo pedagógico

Decide qué enseñar, cuándo y cómo. Mantiene un mapa de habilidades con evidencia, confianza y evolución temporal. Para cada patrón detectado debe:

- agrupar errores relacionados y separar ruido de hábitos;
- estimar frecuencia, severidad, persistencia y posibilidad de mejora;
- inferir la causa pedagógica más probable;
- seleccionar una microlección;
- recuperar posiciones propias y ejemplos maestros comparables;
- generar ejercicios y repetición espaciada;
- medir transferencia a partidas nuevas.

El primer MVP puede implementar esta lógica con reglas transparentes. El ML debe incorporarse donde supere una línea base: clasificación de errores, similitud entre posiciones, priorización de lecciones y estimación de dominio. RL queda para una etapa posterior, cuando exista suficiente interacción para optimizar secuencias de enseñanza.

## Bucle central

1. Importar nuevas partidas.
2. Analizarlas con Stockfish y extraer contexto.
3. Detectar decisiones críticas, no solo grandes pérdidas de evaluación.
4. Etiquetar el tipo y la posible causa del error.
5. Actualizar el mapa personal de habilidades.
6. Elegir el tema con mayor valor esperado de aprendizaje.
7. Entregar una lección corta con posiciones propias.
8. Crear ejercicios y programar revisiones.
9. Observar partidas futuras y medir si el patrón disminuye.

## Experiencia mínima viable

Después de subir o sincronizar partidas, el usuario recibe:

- un diagnóstico semanal de máximo tres patrones prioritarios;
- una explicación clara de por qué cada patrón importa;
- una microlección de 5–10 minutos;
- tres a cinco ejercicios tomados de sus propias partidas;
- una pregunta de reflexión sobre su proceso de decisión;
- seguimiento de recurrencia y progreso durante las semanas siguientes.

## Primer alcance técnico

### Fase 1 — Datos y taxonomía

- Ingesta de PGN de Lichess o Chess.com.
- Normalización de partidas, ratings y controles de tiempo.
- Análisis con Stockfish y detección de decisiones críticas.
- Taxonomía inicial de errores: táctica, cálculo, apertura, estrategia, final, evaluación y gestión del tiempo.
- Reporte exploratorio del historial.

### Fase 2 — Coach basado en evidencia

- Agrupación de posiciones similares con features y embeddings.
- Perfil de fortalezas y debilidades con nivel de confianza.
- Priorizador de lecciones basado en frecuencia, impacto y recurrencia.
- Generador de microlecciones y ejercicios verificables.
- Memoria del progreso por habilidad.

### Fase 3 — Personalización aprendida

- Modelo que predice la elección del jugador frente a alternativas plausibles.
- Clasificador de causas probables de error.
- Knowledge tracing para estimar dominio por habilidad.
- Ranking contextual de la próxima lección.
- Experimentos para comparar recomendaciones contra líneas base.

## Cómo mediremos que funciona

- reducción de errores recurrentes por 100 decisiones críticas;
- mejora en posiciones similares no usadas en la lección;
- calibración del mapa de habilidades;
- porcentaje de lecciones completadas y recordadas;
- transferencia a partidas reales, no solo rendimiento en puzzles;
- utilidad percibida: “esto describe cómo juego y me enseñó algo accionable”.

## Principios

- El motor es una fuente de evidencia, no el profesor.
- Una mala jugada no implica automáticamente una debilidad.
- Toda afirmación sobre el jugador debe mostrar ejemplos y nivel de confianza.
- Las lecciones deben ser pequeñas, concretas y conectadas con decisiones reales.
- El objetivo no es imitar el estilo del jugador, sino ayudarlo a mejorar su proceso de decisión.
- Evitar una arquitectura sofisticada antes de comprobar que el bucle pedagógico aporta valor.

## Primera conversación

Vamos a empezar con un diagnóstico, no entrenando un modelo.

### Parámetros confirmados

- **Plataforma:** Chess.com
- **Usuario:** `cholmess21`
- **Control de tiempo inicial:** 10 minutos (`time_control = 600`)
- **Snapshot inicial (3 de octubre de 2026):** rating Rapid 1236 y 664 partidas Rapid visibles en el perfil público.
- **Objetivo de largo plazo:** progresar hacia 1800, usando hitos intermedios y cambios observables en el proceso de decisión, no solo el rating.

**Primera decisión:** trabajar únicamente con partidas de 10 minutos para no mezclar comportamientos de Rapid con blitz, bullet u otros controles.

**Dataset diagnóstico:** las 200 partidas válidas más recientes de 10 minutos. Se excluirán partidas de uno a cuatro movimientos, abandonos tempranos y registros incompletos. Se conservarán por separado como señales de comportamiento, pero no se usarán para inferir debilidades ajedrecísticas.

**Primer entregable:** un diagnóstico descriptivo con resultados por color, aperturas, duración, forma de término, tendencia del rating y una primera taxonomía de posiciones críticas. Todavía no afirmará causas pedagógicas sin evidencia repetida.

**Primera hipótesis a comprobar:** separar pérdidas por decisiones ajedrecísticas de pérdidas asociadas a tiempo, abandono o partidas anormalmente cortas; luego identificar los primeros dos o tres patrones que aparecen en contextos comparables.

## Instrucciones para trabajar juntos

Actúa como product partner, coach de ajedrez y mentor de ML. En cada sesión:

1. empieza por el objetivo pedagógico o de producto;
2. distingue claramente heurísticas, evidencia y aprendizaje automático;
3. propone el experimento más pequeño que reduzca incertidumbre;
4. evita convertir el proyecto en una demostración técnica sin utilidad para el jugador;
5. termina con una decisión, un entregable y el siguiente paso;
6. usa lenguaje claro, pero explica la lógica técnica cuando ayude a aprender ML.
