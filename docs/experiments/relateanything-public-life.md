# Experimento — RelateAnything para Konta2r Public Life

## Pregunta

¿Un modelo abierto de relaciones visuales mejora de forma reproducible la observación de vida pública de Konta2r respecto de reglas geométricas/temporales más simples?

El objetivo no es demostrar que RelateAnything produce relaciones plausibles en imágenes. Debe demostrar que reduce errores en variables urbanísticas observables y en los indicadores agregados que Konta2r pretende producir.

## Hipótesis

### H1 — persona–objeto

La evidencia relacional visual reduce falsos positivos al diferenciar **uso** de simple proximidad.

Ejemplos:

- sentado en banco vs de pie junto al banco;
- apoyado en borde/muro vs pasando junto a él;
- uso de equipamiento vs proximidad accidental.

### H2 — movilidad modal

La relación visual reduce errores entre:

- ciclista montado;
- persona caminando con bicicleta;
- persona próxima a bicicleta estacionada.

### H3 — persona–persona

La relación visual y su persistencia temporal permiten separar mejor:

- proximidad;
- caminar juntos;
- permanecer juntos;
- interacción visualmente probable.

No se debe traducir automáticamente ninguna de estas observaciones a amistad, parentesco, intención o motivación.

### H4 — persistencia temporal

Una capa temporal sobre scores relacionales reduce la fragmentación de episodios causada por oclusiones y detecciones intermitentes.

## Sistemas a comparar

### A — baseline geométrico

Reglas reproducibles sobre:

- distancia;
- overlap;
- posición relativa;
- trayectoria;
- permanencia;
- zona.

No utiliza relation model.

### B — RelateAnything

Relaciones estimadas desde imagen + regiones candidatas.

La geometría sólo se utiliza para construir candidatos y limitar costo.

### C — híbrido

```text
geometría
  +
relación visual
  ↓
evidencia combinada
```

Las reglas claras pueden resolver casos de bajo costo y el modelo relacional se reserva para ambigüedad.

### D — híbrido temporal

Sistema C más persistencia de relación:

- evidencia positiva;
- evidencia negativa;
- endpoint no observable;
- oclusión breve;
- cierre de episodio.

## Corpus mínimo

El corpus debe congelarse mediante manifest y dividirse en development / selection / held-out test.

### Persona–mobiliario

- sentado correctamente en banco;
- de pie junto a banco;
- pasando junto a banco;
- sentado en borde/murete;
- apoyado en muro/borde;
- sentado en elemento no diseñado como asiento;
- equipamiento parcialmente ocluido.

### Persona–bicicleta

- montado;
- caminando junto a bicicleta;
- empujando bicicleta;
- estacionando/desestacionando;
- persona próxima a bicicleta ajena/estacionada;
- grupo ciclista.

### Persona–persona

- caminando juntos;
- cruzándose sin interacción;
- de pie próximos sin interacción observable;
- conversación visualmente probable;
- sentados juntos;
- grupo;
- oclusión parcial.

### Condiciones espaciales

- baja/alta densidad;
- perspectiva frontal/lateral;
- elementos pequeños/lejanos;
- sombra/contraluz;
- noche sólo si se pretende declarar capacidad nocturna;
- cámara elevada y a nivel peatonal cuando corresponda.

## Ground truth

La unidad anotada no debe ser sólo el frame.

Se requieren:

1. bounding boxes/regiones de endpoints;
2. relación observable por frame o intervalo;
3. estado `not_observable` cuando un endpoint está ocluido;
4. inicio/fin del episodio;
5. elemento semántico utilizado;
6. zona;
7. notas de ambigüedad del anotador.

Cuando la relación no pueda determinarse con seguridad humana, debe existir una categoría `uncertain`; no se fuerza una etiqueta.

## Vocabulario inicial

### Persona–elemento

- sitting on
- leaning against
- standing beside
- using
- looking at

### Persona–persona

- talking to
- walking with
- standing beside
- sitting with
- looking at

### Persona–movilidad

- riding
- holding
- pushing
- walking beside

El vocabulario se tratará como una variable del experimento. Que RelateAnything sea open-vocabulary no implica que todo predicado tenga calidad suficiente.

## Métricas primarias

### Relación

Por predicado:

- precision;
- recall;
- F1;
- curva por threshold;
- falsos positivos por contexto;
- falsos negativos por oclusión/densidad.

### Episodio

- error de inicio;
- error de fin;
- error absoluto de duración;
- fragmentaciones;
- episodios espurios;
- episodios omitidos.

### Indicador urbanístico

El test más importante es el error del producto final.

Ejemplos:

- personas sentadas por zona;
- tiempo-persona sentado;
- uso de un banco específico;
- porcentaje de permanencias con interacción probable;
- ciclistas montados vs bicicletas caminadas;
- distribución temporal de actividades.

Un aumento de F1 que no reduzca el error del indicador final no justifica aumentar el costo del pipeline.

## Métricas operacionales

Medir por dispositivo/perfil:

- descarga del bundle;
- memoria pico;
- session initialization;
- inferencia p50/p95;
- FPS efectivo del pipeline completo;
- temperatura;
- consumo energético cuando sea observable;
- dropped frames;
- estabilidad en ensayos de 30 min, 2 h y prolongados.

Perfiles:

- `eco`;
- `balanced`;
- `performance`.

No asumir que el relation model debe ejecutarse a la misma frecuencia que el detector.

## Candidate gate

El gate debe registrar:

- cantidad de tracks;
- cantidad de elementos estáticos;
- pares posibles;
- pares descartados;
- candidatos enviados al proveedor;
- razón de selección;
- costo temporal del gate.

La reducción de pares es parte del benchmark.

## RelateAnything: condiciones de integración

Repositorio evaluado:

https://github.com/Maelic/RelateAnything

Propiedades relevantes verificadas en su documentación:

- modelo de relaciones separado del detector;
- entrada basada en imagen + regiones;
- vocabulario de predicados configurable;
- exportación ONNX;
- ejecución browser mediante ONNX Runtime Web / WebGPU / WASM;
- código bajo Apache-2.0;
- checkpoints derivados de DINOv3 y sujetos a condiciones de licencia distintas del código;
- detectores Ultralytics del demo son componentes separados y no son necesarios para Konta2r.

Por tanto, el experimento debe reutilizar **nuestro detector** y evitar importar el detector del demo.

## Gate de decisión

No incorporar RelateAnything al runtime estable por calidad visual del demo.

Para cada perfil se debe documentar:

```text
beneficio de medición
    versus
latencia + memoria + energía + licencia + complejidad
```

Resultados posibles:

- `reject`: no mejora de manera material el baseline;
- `research_only`: mejora semántica pero no es operacionalmente viable;
- `performance_only`: viable sólo en hardware alto;
- `balanced_optional`: viable mediante candidate gate y sampling;
- `general_candidate`: suficiente para continuar hacia integración amplia.

Estas etiquetas son estados técnicos internos del experimento, no una afirmación de calidad sin evidencia.

## Reproducibilidad

Cada corrida deberá conservar:

- commit Konta2r;
- commit/versión RelateAnything;
- modelo y hash;
- licencia registrada;
- vocabulario exacto;
- thresholds;
- corpus manifest;
- split;
- dispositivo/navegador;
- runtime/backend;
- frecuencia de evaluación;
- candidate gate config;
- persistence config;
- muestras crudas de latencia;
- métricas por estrato.

## Resultado esperado

El experimento debe permitir responder:

> ¿La incorporación de relaciones visuales mejora de manera medible nuestra capacidad de describir cómo las personas usan y comparten el espacio público, y a qué costo computacional?

Sólo después de responder esa pregunta corresponde decidir una integración operacional.
