# CLAUDE.md

Guía de trabajo para este repositorio. Léela antes de escribir código.

## Qué es esto

Una aplicación de calendario completa: creación, visualización y edición de eventos,
incluyendo recurrencias, en una interfaz web.

## Stack

- **Lenguaje:** TypeScript en todo el proyecto (frontend, capa de datos, lógica). `strict: true`, sin `any` salvo justificación explícita en comentario.
- **Persistencia:** SQLite.
- **Frontend:** web.
- **Librerías externas permitidas — y únicamente estas:**
  - Una librería de fechas: **Luxon** (recomendado; ver nota abajo) o **Temporal**.
  - **rrule** para expansión de recurrencias (RFC 5545).
- Ninguna otra dependencia de lógica de negocio (frameworks de estado, ORMs, utilidades de fecha alternativas, etc.) sin pasar antes por discusión explícita. Herramientas de build/test (bundler, test runner, linter) no cuentan contra esta regla — son infraestructura, no lógica de dominio.

> **Nota sobre Luxon vs Temporal:** propongo Luxon por defecto porque es una librería madura y ampliamente probada en producción. Temporal (el objeto nativo de fecha/hora que reemplaza a `Date`) es semánticamente más limpio para este dominio pero su soporte de runtime todavía es desigual entre entornos, así que si lo elegimos probablemente necesite un polyfill. A discutir.

## La regla de oro (y su matiz según el tipo de evento)

**Nunca se guarda una hora local suelta sin contexto de zona.** Toda la lógica de
conversión de zona horaria vive en la capa de presentación — nunca en `/core` ni en la base de datos.

Pero "todo se guarda en UTC + IANA tz id" no es literalmente uniforme: depende del tipo de
evento (ver siguiente sección). El principio real es más preciso así:

- Para eventos de **hora absoluta**, el dato canónico es **hora local de pared (wall-clock) + identificador IANA de zona**, no un offset UTC fijo. Un offset (`-05:00`) es una fotografía que no sabe cuándo cambia el horario de verano; el IANA tz id (`America/New_York`) sí lo sabe. El instante UTC se **deriva** de (hora local, tz) recalculándolo en cada expansión de ocurrencia — nunca al revés.
- Para eventos de **hora local flotante**, no existe un instante UTC único que representar: por definición, "recordatorio diario a las 8:00" significa 8:00 en la zona que tenga el dispositivo que lo muestra, sea cual sea. Se guarda únicamente la hora de pared, sin tz.
- Para eventos de **día completo**, no existe componente de hora en absoluto: se guarda solo una fecha (o rango de fechas), sin hora ni zona.

Si esta reformulación no captura lo que tenías en mente, dímelo — es el punto más importante de todo el documento y prefiero que quede explícito y acordado antes de tocar el esquema.

Un instante UTC derivado (`*_utc`) sí se cachea en la base de datos para poder indexar y hacer
queries de rango eficientes, pero siempre está marcado como **dato derivado, no autoritativo** —
se recalcula cada vez que cambian la hora de pared, la zona o la regla de recurrencia. Nunca se
edita directamente ni se usa como fuente de verdad para expandir una serie.

## Los tres tipos de evento

No son variantes de un mismo modelo con campos opcionales — son tres modelos con reglas
de conversión y de recurrencia distintas. El código (tipos, validación, expansión) debe
reflejar esa distinción explícitamente en vez de usar un único tipo `Event` con campos `nullable`
ambiguos.

1. **Hora absoluta** (`timed`) — ej. una reunión. Ligado a un instante real del mundo;
   se recalcula correctamente a través de cambios de horario de verano.
2. **Hora local flotante** (`floating`) — ej. un recordatorio diario. Sin zona; se
   reinterpreta contra la zona activa del dispositivo en cada render.
3. **Día completo** (`allday`) — ej. un cumpleaños o vacaciones. Sin hora, zona-agnóstico.

## Arquitectura

```
/core     lógica pura y testeable: modelos de evento, expansión de recurrencias,
          detección de solapamientos, algoritmo de disposición visual.
          Sin dependencias de SQLite, DOM, ni de ningún framework de UI.
          Solo puede depender de la librería de fechas y de rrule.
/db       esquema, migraciones, capa de acceso a datos. Depende de los tipos de /core,
          nunca al revés.
/app      capa de presentación (UI web). Aquí y solo aquí ocurre la conversión de
          zona horaria para mostrar datos al usuario.
```

Regla de dependencia: `/core` no importa nada de `/db` ni de `/app`. Si un archivo en
`/core` necesita saber qué es SQLite o el DOM, está en el lugar equivocado.

## Tests

Los tests de `/core` son obligatorios, no opcionales. Este dominio (recurrencias, DST,
solapamientos, fin de mes) tiene demasiados casos límite para confiar en probarlos a mano.
Cualquier función nueva en `/core` se acompaña de sus tests en el mismo cambio, no después.

Casos que **siempre** deben tener un test explícito, no solo cobertura incidental:
- Transición de horario de verano hacia adelante (hora inexistente) y hacia atrás (hora ambigua).
- `BYMONTHDAY=31` en meses de 30 y de 28/29 días.
- Instancia de una serie recurrente movida, borrada, y "esta y las siguientes".
- Eventos solapados: 2 simultáneos, 3 escalonados, contención total (uno dentro de otro),
  inicio idéntico, back-to-back sin solape.
- Conversión de un evento flotante bajo dos zonas horarias del visor distintas.

## Convenciones de trabajo

- No se añaden abstracciones, flags de features, ni "por si acaso" — si una rebanada
  vertical no lo necesita todavía, no se escribe todavía.
- Cambios de esquema de base de datos se explican en el PR/commit: qué migran, por qué.
