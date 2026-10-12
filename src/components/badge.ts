import { createBackgroundBadge } from "../background-badge";
import { AirqElement, replaceContent } from "./element";

export class AirqBadge extends AirqElement {
  private readonly disclosures = new Set<string>();
  private service: ReturnType<typeof createBackgroundBadge> | null = null;
  private binding = new AbortController();

  get controller(): ReturnType<typeof createBackgroundBadge> {
    if (!this.service) throw new Error("Badge controls are not connected.");
    return this.service;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.service = createBackgroundBadge(() => this.render());
    this.render();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.binding.abort();
    this.service?.dispose();
    this.service = null;
  }

  private render(): void {
    if (!this.isConnected || !this.service) return;
    this.binding.abort();
    this.binding = new AbortController();
    replaceContent(this, this.service.html(), this.disclosures);
    this.service.bind(this, this.binding.signal);
  }
}
