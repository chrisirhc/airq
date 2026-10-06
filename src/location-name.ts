import { z } from "zod";
import type { Coordinate } from "./domain";

export const locationNameSchema = z.object({ label: z.string().trim().min(1).max(200).nullable() });

export async function lookupLocationName(coordinate: Coordinate): Promise<string | null> {
  try {
    const response = await fetch("/api/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coordinate),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const result = locationNameSchema.safeParse(await response.json());
    return result.success ? result.data.label : null;
  } catch {
    return null;
  }
}
