import { z } from "zod";
import {
  type MetricReading,
  type Pm25,
  type Psi,
  pm25Schema,
  psiSchema,
  type RegionReference,
  regionSchema,
} from "./domain";

const regionalPm25Schema = z.object({
  north: pm25Schema,
  south: pm25Schema,
  east: pm25Schema,
  west: pm25Schema,
  central: pm25Schema,
});

const regionalPsiSchema = z.object({
  north: psiSchema,
  south: psiSchema,
  east: psiSchema,
  west: psiSchema,
  central: psiSchema,
});

const timestampSchema = z.iso.datetime({ offset: true }).transform((value, context) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: "custom", message: "Invalid timestamp" });
    return z.NEVER;
  }
  return date;
});

const regionMetadataSchema = z
  .array(
    z.object({
      name: regionSchema,
      labelLocation: z.object({
        latitude: z.number().finite().min(-90).max(90).brand<"Latitude">(),
        longitude: z.number().finite().min(-180).max(180).brand<"Longitude">(),
      }),
    }),
  )
  .length(5)
  .superRefine((metadata, context) => {
    const names = new Set(metadata.map((entry) => entry.name));
    if (names.size !== 5)
      context.addIssue({ code: "custom", message: "Region metadata must be unique" });
  });

const pm25ResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    regionMetadata: regionMetadataSchema,
    items: z
      .array(
        z.object({
          timestamp: timestampSchema,
          updatedTimestamp: timestampSchema,
          readings: z.object({ pm25_one_hourly: regionalPm25Schema }),
        }),
      )
      .min(1),
  }),
});

const psiResponseSchema = z.object({
  code: z.literal(0),
  data: z.object({
    items: z
      .array(
        z.object({
          timestamp: timestampSchema,
          updatedTimestamp: timestampSchema,
          readings: z.object({ psi_twenty_four_hourly: regionalPsiSchema }),
        }),
      )
      .min(1),
  }),
});

type Pm25Reading = MetricReading<Pm25> & { readonly references: readonly RegionReference[] };

export function parsePm25(value: unknown, now: Date, staleAfterMs: number): Pm25Reading {
  const response = pm25ResponseSchema.parse(value);
  const item = response.data.items.at(-1);
  if (!item) throw new Error("PM2.5 response did not contain a reading.");

  return {
    values: item.readings.pm25_one_hourly,
    timestamp: item.timestamp,
    updatedAt: item.updatedTimestamp,
    stale: isStale(item.updatedTimestamp, now, staleAfterMs),
    references: response.data.regionMetadata.map((entry) => ({
      name: entry.name,
      coordinate: entry.labelLocation,
    })),
  };
}

export function parsePsi(value: unknown, now: Date, staleAfterMs: number): MetricReading<Psi> {
  const response = psiResponseSchema.parse(value);
  const item = response.data.items.at(-1);
  if (!item) throw new Error("PSI response did not contain a reading.");

  return {
    values: item.readings.psi_twenty_four_hourly,
    timestamp: item.timestamp,
    updatedAt: item.updatedTimestamp,
    stale: isStale(item.updatedTimestamp, now, staleAfterMs),
  };
}

function isStale(updatedAt: Date, now: Date, staleAfterMs: number): boolean {
  return now.getTime() - updatedAt.getTime() > staleAfterMs;
}
