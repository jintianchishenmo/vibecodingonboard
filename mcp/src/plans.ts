export type Size = "micro" | "small";

export type PlanChoice = {
  id: string;
  memoryGiB: number;
  price: number;
  linux: boolean;
};

const NEED: Record<Size, number> = { micro: 1, small: 2 };

/** Smallest Linux plan that meets the size. Same memory: take the cheaper one. */
export function pickPlan(plans: PlanChoice[], size: Size): PlanChoice {
  const linux = plans.filter((plan) => plan.linux);
  const fit = linux
    .filter((plan) => plan.memoryGiB >= NEED[size])
    .sort((a, b) => a.memoryGiB - b.memoryGiB || a.price - b.price);
  if (fit[0]) return fit[0];
  const cheapest = [...linux].sort((a, b) => a.price - b.price).slice(0, 3);
  const listed = cheapest.map((plan) => `${plan.id} (${plan.memoryGiB} GiB)`).join(", ");
  throw new Error(listed ? `No ${size} plan in this region. Cheapest: ${listed}` : `No Linux plan in this region.`);
}
