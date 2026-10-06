export type Pm25Band =
  | { readonly level: 1; readonly label: "Normal" }
  | { readonly level: 2; readonly label: "Elevated" }
  | { readonly level: 3; readonly label: "High" }
  | { readonly level: 4; readonly label: "Very High" };

export type PsiDescriptor = "Good" | "Moderate" | "Unhealthy" | "Very unhealthy" | "Hazardous";

export function classifyPm25(value: number): Pm25Band {
  if (value <= 55) return { level: 1, label: "Normal" };
  if (value <= 150) return { level: 2, label: "Elevated" };
  if (value <= 250) return { level: 3, label: "High" };
  return { level: 4, label: "Very High" };
}

export function classifyPsi(value: number): PsiDescriptor {
  if (value <= 50) return "Good";
  if (value <= 100) return "Moderate";
  if (value <= 200) return "Unhealthy";
  if (value <= 300) return "Very unhealthy";
  return "Hazardous";
}

export function statusTone(value: number, metric: "pm25" | "psi"): string {
  const level = metric === "pm25" ? classifyPm25(value).level : psiLevel(value);
  return `${metric}-tone-${level}`;
}

function psiLevel(value: number): 1 | 2 | 3 | 4 | 5 {
  if (value <= 50) return 1;
  if (value <= 100) return 2;
  if (value <= 200) return 3;
  if (value <= 300) return 4;
  return 5;
}
