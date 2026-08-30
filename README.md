# konta2r

**Konta2r** es una plataforma abierta de visión artificial para observar, medir y auditar movilidad y uso del espacio público.

El proyecto nace de un prototipo en navegador basado en TensorFlow.js + COCO-SSD (`contador.html`). Ese prototipo demostró la viabilidad de detectar usuarios, contar cruces, registrar dirección, georreferenciar sesiones, almacenar eventos localmente y observar permanencias. A partir de ahora se conserva como antecedente funcional, pero la nueva versión se desarrolla con una arquitectura modular y con criterios explícitos de validez de medición.

## Objetivo

Construir un instrumento reproducible para estudios de movilidad capaz de transformar video en **trayectorias y eventos auditables**, no solo en detecciones por cuadro.

La unidad de análisis será el **usuario de movilidad** y su trayectoria. El flujo conceptual es:

`video → detección → asociación modal → tracking → motor espacial → eventos → almacenamiento → validación`

## Principios

- **Privacidad por diseño:** inferencia local siempre que el dispositivo lo permita; no se requiere almacenar rostros ni matrículas.
- **Trazabilidad:** cada conteo debe poder vincularse a modelo, configuración, track, geometría y sesión.
- **Reproducibilidad:** dependencias y modelos versionados; configuración exportable.
- **Validez antes que apariencia:** precisión del instrumento y protocolo de validación por sobre una interfaz llamativa.
- **Arquitectura modular:** detector, tracker, clasificación modal y reglas espaciales intercambiables.
- **Orientación a movilidad:** peatones, bicicletas, ciclos, motocicletas, automóviles, buses, camiones y otras categorías deben modelarse como entidades de movilidad, evitando dobles conteos de objetos que pertenecen al mismo usuario.

## Estado

🧪 **Reinicio arquitectónico / v2 en desarrollo.**

La rama `main` contiene la definición estable del proyecto. El desarrollo de la nueva arquitectura se realizará mediante ramas y pull requests, manteniendo documentadas decisiones metodológicas y técnicas.

## Líneas de trabajo

1. motor geométrico correcto para cruces, sentidos, zonas y trayectorias;
2. tracking multiobjeto robusto ante oclusiones;
3. fusión persona–vehículo para obtener usuarios modales;
4. inferencia en navegador con backend acelerado y fallback compatible;
5. esquema de datos científico y auditable;
6. protocolo de validación contra observación manual;
7. PWA para trabajo de campo, con operación offline;
8. calibración espacial para velocidad y métricas métricas cuando la geometría lo permita.

## Origen

La primera versión fue desarrollada por Ariel López como una herramienta de conteo y observación de tránsito mediante visión artificial. La v2 toma esa experiencia como punto de partida y redefine el sistema para convertirlo en una plataforma de medición de movilidad.
