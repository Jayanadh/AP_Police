/** From this share of the limit a bar turns amber; at the limit it turns red. */
const WARN_FROM_PERCENT = 80;

export type Usage = {
  /** Whole percent for the bar, 0 to 100. */
  percent: number;
  tone: 'warning' | 'danger' | '';
};

/** Litres used against a limit. A limit of zero counts as full once anything is used. */
export function usage(used: string, limit: string): Usage {
  const usedLitres = Number(used);
  const limitLitres = Number(limit);
  const share = limitLitres > 0 ? (usedLitres / limitLitres) * 100 : usedLitres > 0 ? 100 : 0;
  let tone: Usage['tone'] = '';
  if (share >= 100) {
    tone = 'danger';
  } else if (share >= WARN_FROM_PERCENT) {
    tone = 'warning';
  }
  return { percent: Math.min(100, Math.max(0, Math.round(share))), tone };
}
