import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { type AirQualityController, createAirQualityController } from "./air-quality-controller";
import type { AirQualitySnapshot } from "./domain";

const AirQualityContext = createContext<AirQualityController | null>(null);

export function AirQualityProvider({
  readings,
  children,
}: {
  readings: AirQualitySnapshot;
  children: ReactNode;
}) {
  const [controller] = useState(() => createAirQualityController(readings));
  useEffect(() => controller.start(), [controller]);
  useEffect(() => controller.updateReadings(readings), [controller, readings]);
  return <AirQualityContext value={controller}>{children}</AirQualityContext>;
}

function useAirQualityStore() {
  const controller = use(AirQualityContext);
  if (!controller) throw new Error("Air-quality controls require an AirQualityProvider.");
  return controller;
}

export function useAirQuality() {
  const controller = useAirQualityStore();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return {
    state,
    requestLocation: controller.requestLocation,
    selectRegion: controller.selectRegion,
  };
}

export function useBadgeControls() {
  const controller = useAirQualityStore();
  const view = useSyncExternalStore(controller.subscribe, controller.getBadgeSnapshot);
  return { view, badge: controller.badge };
}
