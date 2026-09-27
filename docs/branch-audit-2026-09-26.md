# Auditoría y consolidación de ramas — 2026-09-26

## Resultado

Konta2r fue consolidado desde un esquema histórico `main + develop + feature/*` a un flujo **main-first**.

Antes de la consolidación existían 71 ramas. Después de la auditoría y limpieza quedan únicamente:

- `main` — rama canónica y fuente de verdad del proyecto;
- `evidence/probe-opencv-nanodet` — evidencia histórica reproducible;
- `evidence/probe-opencv-ssd` — evidencia histórica reproducible;
- `evidence/probe-opencv-ssd-v2` — evidencia histórica reproducible.

La rama `develop` y 66 ramas `feature/*` fueron eliminadas después de revisar su relación con `main`.

## Método de auditoría

La revisión no se basó únicamente en la relación de ancestros Git.

Una parte importante del desarrollo histórico fue integrada mediante pull requests con squash o mediante ramas apiladas. Por esa razón, algunas ramas aparecían como `diverged` aunque su contenido hubiese sido incorporado posteriormente.

Se aplicaron tres comprobaciones:

1. relación `ahead/behind` respecto de `main`;
2. estado y commit de cabecera de los pull requests históricos;
3. inspección específica de ramas con commits no ancestrales para distinguir trabajo perdido de implementaciones posteriormente reemplazadas.

Dos ramas requirieron revisión funcional adicional:

- `feature/node-operational-status-panel`: su implementación antigua de readiness local fue superada por la arquitectura integrada basada en `NodeCommunityRuntime` y `NodeCommunityPanel`;
- `feature/paired-detector-benchmark`: el comparador histórico fue reemplazado en `main` por una implementación posterior y más estricta de comparación pareada.

No se identificó una línea de producto vigente que requiriera rescate antes de borrar estas ramas.

## Evidencia preservada

Las tres ramas `evidence/*` se mantienen deliberadamente porque conservan ejecuciones experimentales específicas y permiten rastrear la construcción de evidencia de los candidatos ONNX.

No son ramas de desarrollo.

Los workflows NanoDet fueron desacoplados de las ramas históricas `feature/*`. Ahora se ejecutan manualmente desde `main`, generan evidencia como artefacto de GitHub Actions y no realizan commits automáticos sobre ramas experimentales.

## Política vigente

El desarrollo normal sigue:

```text
main
  ↑
pull request
  ↑
feature/* | fix/* | experiment/*
```

Las ramas de trabajo nacen desde `main`, vuelven a `main` mediante pull request y se eliminan después del merge.

Una rama `evidence/*` puede conservarse sólo cuando existe una razón explícita de trazabilidad o reproducibilidad experimental.

## CI

El CI principal se ejecuta únicamente para `main` y pull requests dirigidos a `main`.

Durante la consolidación se detectó un fallo del resolvedor Arborist incluido en npm 10.9.x al instalar el árbol actual con Vitest 4.1. El workflow mantiene Node 22 y actualiza npm a la rama 11 antes de instalar dependencias, evitando cambiar simultáneamente el runtime Node y el gestor de paquetes.

## Hito de consolidación

El PR #6 promovió 624 commits acumulados desde `develop` a `main` preservando la historia mediante merge. Desde ese hito, `main` representa la versión integrada de Konta2r.
