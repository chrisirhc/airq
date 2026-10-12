declare module "*.elm" {
  export const Elm: {
    Main: {
      init(options: { node: HTMLElement; flags: string }): {
        ports: {
          events: { send(value: Record<string, unknown>): void };
          effects: { subscribe(callback: (effect: Effect) => void): void };
        };
      };
    };
  };
  type Effect =
    | { kind: "load" | "restoreLocation" }
    | { kind: "location"; id: number }
    | { kind: "lookup"; id: number; coordinate: unknown }
    | { kind: "preference"; enabled: boolean }
    | { kind: "theme"; theme: string }
    | {
        kind: "sync";
        replace: boolean;
        region: string;
        location: null | {
          coordinate: unknown;
          capturedAt: number;
          fingerprint: string;
          weights: Record<string, number>;
        };
      };
}
