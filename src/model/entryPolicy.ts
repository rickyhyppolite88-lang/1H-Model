import { z } from "zod";

export const entryPolicySchema = z.object({
  method: z.literal("last-pretip-v1"),
  startedAt: z.iso.datetime(),
  maxQuoteAgeMinutes: z.literal(15),
  legacyGameKeys: z.array(z.string()).optional(),
});
export type EntryPolicy = z.infer<typeof entryPolicySchema>;
export const usesTipoffEntry = (
  startsAt: string,
  policy?: EntryPolicy,
  gameKey?: string,
) =>
  Boolean(
    policy &&
      (!gameKey || !policy.legacyGameKeys?.includes(gameKey)) &&
      Date.parse(startsAt) >= Date.parse(policy.startedAt),
  );
export function verifiedTipoffQuote(
  startsAt: string,
  capturedAt: string | null | undefined,
  policy?: EntryPolicy,
  gameKey?: string,
) {
  if (!usesTipoffEntry(startsAt, policy, gameKey)) return true;
  if (!capturedAt || !policy) return false;
  const age = Date.parse(startsAt) - Date.parse(capturedAt);
  return (
    Number.isFinite(age) && age > 0 && age <= policy.maxQuoteAgeMinutes * 60_000
  );
}
export function mergeEntryPolicies(policies: (EntryPolicy | undefined)[]) {
  const defined = policies.filter(
    (policy): policy is EntryPolicy => policy !== undefined,
  );
  if (
    new Set(
      defined.map((policy) =>
        JSON.stringify([
          policy.method,
          policy.startedAt,
          policy.maxQuoteAgeMinutes,
          [...(policy.legacyGameKeys ?? [])].sort(),
        ]),
      ),
    ).size > 1
  )
    throw new Error("Conflicting entry policies");
  return defined[0];
}
