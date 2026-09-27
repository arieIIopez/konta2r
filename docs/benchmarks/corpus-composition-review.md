# Revisión descriptiva de composición del corpus

## Propósito

`?diagnostics=corpus` permite inspeccionar un `AnnotatedBenchmarkSequence` antes de usarlo en una corrida de benchmark. La herramienta responde **qué contiene la secuencia**, no si el corpus es científicamente “bueno” o “malo”.

Esto evita convertir decisiones de diseño de investigación en una puntuación automática sin fundamento. Una calle puede legítimamente no contener buses; una secuencia nocturna puede no contener ciclistas; un experimento puede buscar deliberadamente oclusiones fuertes. La ausencia se informa porque condiciona qué conclusiones pueden extraerse, no porque invalide automáticamente la observación.

## Resumen producido

El reporte calcula:

- número de frames;
- objetos totales, evaluables e ignorados;
- frames sin objetos evaluables (`negativeFrameCount`);
- conteos por clase;
- conteos de oclusión entre objetos evaluables;
- estratos `tiny/small/medium/large` según altura relativa en imagen;
- frames `planned`, `manual` y sin clasificación de procedencia;
- cobertura del plan temporal cuando existe.

Los objetos `ignore=true` se cuentan como presencia anotada, pero no alimentan los resúmenes de dificultad evaluable de oclusión/escala.

## Hallazgos automáticos

Los hallazgos se limitan a `info` y `warning`.

Ejemplos:

- plan temporal incompleto;
- muy pocos frames para describir variación temporal;
- ausencia de frames puramente negativos;
- ausencia de objetos ocluidos;
- ausencia de objetos tiny/small;
- presencia de frames manuales además de los planificados;
- una clase canónica ausente en esta secuencia.

No existen campos `valid`, `status` o `score` en `CorpusCompositionReport`.

## Interpretación de frames negativos

Un frame sin objetos evaluables aporta exposición a fondo/infraestructura sin un objeto objetivo que deba ser detectado. Su ausencia no vuelve inválida la secuencia: falsos positivos también pueden aparecer en frames con objetos. Sin embargo, un corpus sin escenas puramente de fondo ofrece menos evidencia específica sobre ese tipo de error.

## Interpretación por clase

Si una clase no aparece, no pueden calcularse precision/recall/F1 defendibles para esa clase a partir de esa secuencia. Esto no implica que el video deba descartarse; el déficit puede compensarse en otras secuencias del corpus multi-ubicación.

Por eso la revisión debe hacerse en dos escalas:

1. por secuencia, para conocer sus condiciones y limitaciones;
2. agregada entre secuencias, para diseñar cobertura de la red experimental.

La segunda capa todavía no se considera resuelta por esta herramienta.

## Flujo recomendado

```text
video local
  → plan de muestreo
  → anotación
  → JSON
  → revisión de composición
  → correcciones justificadas de anotación si corresponde
  → congelar corpus/hash
  → benchmark
```

No deben añadirse frames manuales solo para “hacer desaparecer” advertencias de composición. Si se incorporan casos adversariales o raros, deben permanecer etiquetados `manual` y reportarse separadamente cuando corresponda.
