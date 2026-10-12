/** Connection-scoped listeners; a removed element can be connected again safely. */
export abstract class AirqElement extends HTMLElement {
  protected connection = new AbortController();

  connectedCallback(): void {
    this.connection.abort();
    this.connection = new AbortController();
  }

  disconnectedCallback(): void {
    this.connection.abort();
  }
}

/** Preserve native disclosure choices and keyboard focus across a local template update. */
export function replaceContent(root: HTMLElement, html: string, disclosures: Set<string>): void {
  for (const disclosure of root.querySelectorAll<HTMLDetailsElement>("details[id]")) {
    if (disclosure.open) disclosures.add(disclosure.id);
    else disclosures.delete(disclosure.id);
  }
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? active : null;
  const focusId = focused?.id;
  const summaryId = focused?.tagName === "SUMMARY" ? focused.parentElement?.id : null;
  const retryFocused = focused?.classList.contains("retry-button");
  root.innerHTML = html;
  for (const disclosure of root.querySelectorAll<HTMLDetailsElement>("details[id]")) {
    disclosure.open = disclosures.has(disclosure.id);
  }
  const findId = (id: string) =>
    Array.from(root.querySelectorAll<HTMLElement>("[id]")).find((element) => element.id === id);
  const replacement = focusId
    ? findId(focusId)
    : summaryId
      ? findId(summaryId)?.querySelector<HTMLElement>("summary")
      : retryFocused
        ? root.querySelector<HTMLElement>(".retry-button")
        : null;
  replacement?.focus({ preventScroll: true });
}

export function emit(element: HTMLElement, type: string, detail?: unknown): void {
  element.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}
