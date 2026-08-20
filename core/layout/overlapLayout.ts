// Disposición de intervalos solapados en columnas. Ver DESIGN.md §5.
// Función pura: recibe intervalos ya expandidos a minutos (o cualquier unidad
// lineal comparable) y devuelve columna + expansión de cada uno. No sabe nada
// de fechas de pared, zonas horarias, SQLite ni DOM -- eso vive en /app.

export interface LayoutInput<T> {
  readonly item: T;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface LaidOutItem<T> {
  readonly item: T;
  readonly startMinutes: number;
  readonly endMinutes: number;
  /** Columna asignada (0-indexada) dentro de su cluster de solape. */
  readonly column: number;
  /** Cuántas columnas consecutivas ocupa a partir de `column`, tras la pasada de expansión. */
  readonly columnSpan: number;
  /** Total de columnas del cluster al que pertenece este evento. */
  readonly totalColumns: number;
}

const DEFAULT_EPSILON_MINUTES = 1;

interface Interval {
  readonly start: number;
  readonly end: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Para eventos de duración cero (recordatorios puntuales) la fórmula de
 * solape estándar (a.start < b.end && b.start < a.end) nunca es cierta --
 * un punto no tiene interior. Se les da un "grosor" mínimo epsilon solo para
 * efectos de comparación de solape/columna; el `endMinutes` original que se
 * devuelve en el resultado no se toca.
 */
function effectiveEnd(start: number, end: number, epsilon: number): number {
  return Math.max(end, start + epsilon);
}

export function layoutOverlaps<T>(
  inputs: readonly LayoutInput<T>[],
  epsilonMinutes: number = DEFAULT_EPSILON_MINUTES,
): LaidOutItem<T>[] {
  if (inputs.length === 0) return [];

  interface Normalized {
    readonly input: LayoutInput<T>;
    readonly effEnd: number;
  }

  const normalized: Normalized[] = inputs.map((input) => ({
    input,
    effEnd: effectiveEnd(input.startMinutes, input.endMinutes, epsilonMinutes),
  }));

  // Orden: por inicio asc; empate, mayor duración primero (para que "contenga"
  // visualmente al más corto, ver DESIGN.md §5 pasada 1).
  const sorted = [...normalized].sort((a, b) => {
    if (a.input.startMinutes !== b.input.startMinutes) return a.input.startMinutes - b.input.startMinutes;
    const durA = a.effEnd - a.input.startMinutes;
    const durB = b.effEnd - b.input.startMinutes;
    return durB - durA;
  });

  // Pasada 1a -- agrupar en clusters de colisión por barrido. Correcto para
  // componentes conexas transitivas (A-B-C aunque A y C no se toquen)
  // porque el cluster extiende su fin al máximo visto hasta ahora.
  const clusters: Normalized[][] = [];
  let currentCluster: Normalized[] = [];
  let clusterEnd = -Infinity;
  for (const entry of sorted) {
    if (currentCluster.length === 0 || entry.input.startMinutes < clusterEnd) {
      currentCluster.push(entry);
      clusterEnd = Math.max(clusterEnd, entry.effEnd);
    } else {
      clusters.push(currentCluster);
      currentCluster = [entry];
      clusterEnd = entry.effEnd;
    }
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const results: LaidOutItem<T>[] = [];

  for (const cluster of clusters) {
    // Pasada 1b -- greedy interval graph coloring: primera columna libre.
    const columnEnds: number[] = [];
    const assigned: { entry: Normalized; column: number }[] = [];

    for (const entry of cluster) {
      let placedColumn = -1;
      for (let c = 0; c < columnEnds.length; c++) {
        if ((columnEnds[c] as number) <= entry.input.startMinutes) {
          placedColumn = c;
          break;
        }
      }
      if (placedColumn === -1) {
        placedColumn = columnEnds.length;
        columnEnds.push(entry.effEnd);
      } else {
        columnEnds[placedColumn] = entry.effEnd;
      }
      assigned.push({ entry, column: placedColumn });
    }

    const totalColumns = columnEnds.length;

    // Pasada 2 -- expandir cada evento hacia la derecha hasta la primera
    // columna con la que de verdad solape en el tiempo.
    for (const { entry, column } of assigned) {
      const selfInterval: Interval = { start: entry.input.startMinutes, end: entry.effEnd };
      let span = 1;
      for (let c = column + 1; c < totalColumns; c++) {
        const collides = assigned.some(({ entry: other, column: otherColumn }) => {
          if (otherColumn !== c) return false;
          return overlaps(selfInterval, { start: other.input.startMinutes, end: other.effEnd });
        });
        if (collides) break;
        span++;
      }

      results.push({
        item: entry.input.item,
        startMinutes: entry.input.startMinutes,
        endMinutes: entry.input.endMinutes,
        column,
        columnSpan: span,
        totalColumns,
      });
    }
  }

  return results;
}
