import { z } from "zod";
import { SlaError } from "./domain";

const cursorSchema = z.object({ queue: z.number().int().min(0).max(9), cursor: z.string().max(2048), seen: z.array(z.string().max(2048)).max(200) });
const schema = z.object({ v: z.literal(1), phase: z.enum(["discover", "recheck"]), cursor: cursorSchema.nullable(), pages: z.number().int().min(0).max(2000), records: z.number().int().min(0), limited: z.boolean() }).strict();
export type SlaCheckpoint = z.infer<typeof schema>;
export function slaCheckpoint(value: unknown): SlaCheckpoint {
  if (value === undefined || value === null) return { v: 1, phase: "discover", cursor: { queue: 0, cursor: "", seen: [] }, pages: 0, records: 0, limited: false };
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.phase === "discover" && parsed.data.cursor === null) throw new SlaError("SLA_CHECKPOINT_INVALID");
  return parsed.data;
}
export function publicSlaCheckpoint(value: unknown) {
  try { const state = slaCheckpoint(value); return { phase: state.phase, pages: state.pages, unitsObserved: state.records, limited: state.limited }; } catch { return null; }
}
