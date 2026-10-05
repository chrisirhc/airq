import { z } from "zod";

export const regionSchema = z.enum(["north", "south", "east", "west", "central"]);
export type Region = z.infer<typeof regionSchema>;

export const REGIONS = regionSchema.options;

export const REGION_LABELS: Record<Region, string> = {
  north: "North",
  south: "South",
  east: "East",
  west: "West",
  central: "Central",
};

export const latitudeSchema = z.number().finite().min(-90).max(90).brand<"Latitude">();
export const longitudeSchema = z.number().finite().min(-180).max(180).brand<"Longitude">();
export const pm25Schema = z.number().finite().nonnegative().brand<"Pm25">();
export const psiSchema = z.number().finite().nonnegative().brand<"Psi">();

export type Latitude = z.infer<typeof latitudeSchema>;
export type Longitude = z.infer<typeof longitudeSchema>;
export type Pm25 = z.infer<typeof pm25Schema>;
export type Psi = z.infer<typeof psiSchema>;

export const coordinateSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
});
export type Coordinate = z.infer<typeof coordinateSchema>;

export type RegionalValues<T> = Record<Region, T>;

export interface RegionReference {
  readonly name: Region;
  readonly coordinate: Coordinate;
}

export interface MetricReading<T> {
  readonly values: RegionalValues<T>;
  readonly timestamp: Date;
  readonly updatedAt: Date;
  readonly stale: boolean;
}

export type ReadingSource = "live" | "cached";

export type MetricResult<T> =
  | { readonly kind: "available"; readonly source: ReadingSource; readonly reading: T }
  | { readonly kind: "unavailable"; readonly message: string };

export interface AirQualitySnapshot {
  readonly pm25: MetricResult<
    MetricReading<Pm25> & { readonly references: readonly RegionReference[] }
  >;
  readonly psi: MetricResult<MetricReading<Psi>>;
}
