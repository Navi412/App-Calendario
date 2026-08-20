/**
 * Compara fecha/hora de inicio y fin de pared (mismo formato ISO, así que
 * la comparación de strings basta -- no hace falta tocar Luxon aquí).
 * Devuelve un mensaje de error o null si el intervalo es válido.
 */
export function validateInterval(
  startDate: string,
  startTime: string,
  endDate: string,
  endTime: string,
): string | null {
  if (!startDate || !startTime || !endDate || !endTime) {
    return "Completa fecha y hora de inicio y fin.";
  }
  const start = `${startDate}T${startTime}`;
  const end = `${endDate}T${endTime}`;
  if (end <= start) {
    return "La fecha y hora de fin debe ser posterior a la de inicio.";
  }
  return null;
}

/**
 * Para eventos de día completo: `endDateInclusive` es el último día que el
 * usuario ve seleccionado en el formulario (inclusivo, más natural para
 * elegir). Debe ser igual o posterior a la fecha de inicio -- la conversión
 * al `endDate` exclusivo que se guarda ocurre en el llamador.
 */
export function validateAllDayInterval(startDate: string, endDateInclusive: string): string | null {
  if (!startDate || !endDateInclusive) {
    return "Completa fecha de inicio y fin.";
  }
  if (endDateInclusive < startDate) {
    return "La fecha de fin debe ser igual o posterior a la de inicio.";
  }
  return null;
}
