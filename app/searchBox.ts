import type { EventSearchResult } from "../db/events.repository.js";
import { escapeHtml } from "./util.js";

export interface SearchBoxHandlers {
  readonly onQuery: (query: string) => Promise<readonly EventSearchResult[]>;
  readonly onResultClick: (result: EventSearchResult) => void;
}

const DEBOUNCE_MS = 200;

/**
 * Buscador en la topbar: se renderiza UNA vez al arrancar (no en cada
 * refresh de vista) porque no depende de la fecha/vista actual, solo del
 * calendario activo -- y eso ya lo resuelve `handlers.onQuery` por closure
 * en main.ts, así que no hace falta reconstruirlo nunca.
 */
export function renderSearchBox(container: HTMLElement, handlers: SearchBoxHandlers): void {
  container.innerHTML = `
    <div class="search-box">
      <input type="search" class="search-input" placeholder="Buscar eventos..." autocomplete="off" aria-label="Buscar eventos" />
      <div class="search-results" hidden></div>
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>(".search-input");
  const results = container.querySelector<HTMLElement>(".search-results");
  if (!input || !results) return;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let requestId = 0;

  function hideResults(): void {
    results!.hidden = true;
    results!.innerHTML = "";
  }

  function renderResults(matches: readonly EventSearchResult[]): void {
    if (matches.length === 0) {
      results!.hidden = false;
      results!.innerHTML = `<p class="search-empty">Sin resultados.</p>`;
      return;
    }
    results!.hidden = false;
    results!.innerHTML = matches
      .map(
        (m, i) => `
        <button type="button" class="search-result" data-index="${i}">
          <span class="search-result-title">${escapeHtml(m.title)}</span>
          <span class="search-result-date">${m.startDate}${m.kind === "allday" ? " · día completo" : ""}</span>
        </button>
      `,
      )
      .join("");
    for (const btn of results!.querySelectorAll<HTMLButtonElement>(".search-result")) {
      const idx = Number(btn.dataset["index"]);
      btn.addEventListener("click", () => {
        const match = matches[idx];
        if (match) handlers.onResultClick(match);
        hideResults();
        input!.value = "";
      });
    }
  }

  input.addEventListener("input", () => {
    const query = input.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!query.trim()) {
      hideResults();
      return;
    }
    const thisRequestId = ++requestId;
    debounceTimer = setTimeout(() => {
      void handlers.onQuery(query).then((matches) => {
        // Descarta respuestas de búsquedas ya superadas por una más reciente.
        if (thisRequestId !== requestId) return;
        renderResults(matches);
      });
    }, DEBOUNCE_MS);
  });

  input.addEventListener("focus", () => {
    if (input.value.trim() && results!.innerHTML) results!.hidden = false;
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target as Node)) hideResults();
  });
}
