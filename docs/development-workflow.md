# Flujo de desarrollo

## Rama canónica

`main` es la única rama permanente que representa el estado integrado de Konta2r.

La rama `develop` fue utilizada durante la construcción inicial de la v2. Todo su contenido fue promovido a `main` el 26 de septiembre de 2026 mediante el PR #6. Desde ese hito queda deprecada como rama de desarrollo.

## Modelo de trabajo

Cada cambio parte desde la versión vigente de `main` y utiliza una rama temporal:

- `feature/<nombre>` para capacidades nuevas;
- `fix/<nombre>` para correcciones;
- `experiment/<nombre>` para experimentos que todavía no forman parte del producto;
- `evidence/<nombre>` cuando la rama misma forma parte de una cadena de evidencia reproducible.

El flujo normal es:

```text
main
  └── rama temporal
          └── commits
                  └── pull request → main
```

No se deben apilar nuevas ramas sobre ramas históricas cerradas salvo que exista una razón técnica explícita y documentada.

## Integración

Un PR hacia `main` debe describir:

- propósito del cambio;
- alcance y archivos o componentes afectados;
- evidencia de pruebas;
- impactos metodológicos o de medición cuando corresponda;
- límites conocidos;
- efectos sobre privacidad, seguridad o reproducibilidad cuando sean pertinentes.

Antes del merge deben pasar los checks aplicables del repositorio.

## Después del merge

Una rama temporal que quedó completamente contenida en `main` deja de ser una línea de desarrollo activa.

Puede conservarse únicamente cuando:

- contiene evidencia experimental que debe permanecer referenciable;
- está vinculada a un protocolo de reproducción;
- existe trabajo exclusivo todavía no integrado.

En los demás casos debe cerrarse su PR y eliminarse la rama para reducir ruido operacional.

## Regla para agentes y automatizaciones

Toda automatización, agente o asistente que genere cambios en Konta2r debe tomar `main` como base y proponer el resultado nuevamente contra `main`.

No se debe asumir que `develop` contiene una versión más nueva del proyecto.

## Historial

La separación inicial entre `main` y `develop` acumuló 624 commits de desarrollo antes de la consolidación. Se preservó la historia mediante merge, sin reescritura ni force-push.
