// Client-safe optimisation-cadence constants and value types — no server/supabase imports,
// so client components can use these without pulling the DB client into the browser bundle.
// (Importing a runtime value from lib/optimisations would drag in lib/supabase, which throws
// on evaluation in the browser because the service-role env vars aren't there.)

export const PRIMARY_METRICS = ['optin_rate', 'deposit_rate', 'optins', 'deposits', 'lp_views'] as const;
export type PrimaryMetric = (typeof PRIMARY_METRICS)[number];

export const METRIC_LABELS: Record<PrimaryMetric, string> = {
  optin_rate: 'Opt-in rate',
  deposit_rate: 'Conversion rate',
  optins: 'Opt-ins',
  deposits: 'Deposits',
  lp_views: 'LP views',
};

export const VERDICTS = ['win', 'loss', 'flat', 'rolled_back'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  win: 'Win',
  loss: 'Loss',
  flat: 'Flat',
  rolled_back: 'Rolled back',
};

/** True for metrics measured in percent, which compare in percentage POINTS. */
export const isRateMetric = (m: PrimaryMetric): boolean => m === 'optin_rate' || m === 'deposit_rate';

/**
 * Traffic each version needs before a split test may be called, and the confidence bar it
 * must clear. Lives here, not in lib/splitTests.ts, so the client components that explain
 * "how far off is this test?" can read the same numbers the server judges by — a threshold
 * duplicated as a literal in the UI drifts the moment the statistics are tuned.
 */
export const SPLIT_MIN_VIEWS_PER_VARIANT = 30;
export const SPLIT_CONFIDENCE_TO_CALL = 95;
