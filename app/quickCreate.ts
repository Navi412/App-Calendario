import { DateTime } from "luxon";

export type QuickCreateContext =
  | { readonly kind: "timed"; readonly date: string; readonly startTime: string; readonly endDate: string; readonly endTime: string }
  | { readonly kind: "allday"; readonly date: string };

function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

function contextLabel(context: QuickCreateContext): string {
  const dt = DateTime.fromISO(context.date).setLocale("es");
  if (context.kind === "allday") return capitalize(dt.toFormat("cccc d 'de' LLLL"));
  return `${capitalize(dt.toFormat("ccc d LLL"))} · ${context.startTime.slice(0, 5)}–${context.endTime.slice(0, 5)}`;
}

let activePopover: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

/** Cierra el popup de creación rápida abierto, si hay uno -- se llama antes de abrir uno nuevo y cuando cualquier otra acción (navegar, abrir el modal de edición) debería descartarlo. */
export function closeQuickCreatePopover(): void {
  activeCleanup?.();
}

/**
 * Popup mínimo anclado al punto donde se hizo click en la rejilla/celda: un
 * único campo de título, Enter crea el evento en la fecha/hora ya resuelta
 * por el llamador (ver dayView/weekView/monthView), Esc o click fuera lo
 * descarta. A propósito no expone más campos -- para eso ya está el panel
 * "+ Crear" con el formulario completo.
 */
export function openQuickCreatePopover(
  anchor: { readonly x: number; readonly y: number },
  context: QuickCreateContext,
  onSubmit: (title: string) => Promise<void>,
): void {
  closeQuickCreatePopover();

  const popover = document.createElement("div");
  popover.className = "quick-create-popover";
  popover.innerHTML = `
    <div class="quick-create-context">${contextLabel(context)}</div>
    <form>
      <input name="title" type="text" placeholder="Añadir título" autocomplete="off" />
    </form>
    <div class="quick-create-hint">Enter para crear · Esc para cancelar</div>
  `;
  document.body.appendChild(popover);
  activePopover = popover;

  const rect = popover.getBoundingClientRect();
  const left = Math.max(Math.min(anchor.x, window.innerWidth - rect.width - 8), 8);
  const top = Math.max(Math.min(anchor.y, window.innerHeight - rect.height - 8), 8);
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  const input = popover.querySelector<HTMLInputElement>('input[name="title"]');
  const form = popover.querySelector("form");
  input?.focus();

  function cleanup(): void {
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    document.removeEventListener("keydown", onKeydown, true);
    popover.remove();
    if (activePopover === popover) activePopover = null;
    if (activeCleanup === cleanup) activeCleanup = null;
  }
  activeCleanup = cleanup;

  function onOutsidePointerDown(e: PointerEvent): void {
    if (!popover.contains(e.target as Node)) cleanup();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      cleanup();
    }
  }

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = input?.value.trim() ?? "";
    if (!title) {
      cleanup();
      return;
    }
    void onSubmit(title).then(cleanup);
  });

  // Se registran en el siguiente tick para no reaccionar al mismo click/pointerdown que abrió este popup.
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
    document.addEventListener("keydown", onKeydown, true);
  }, 0);
}
