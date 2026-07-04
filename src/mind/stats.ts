/**
 * Statistical primitives for the mind layer — replaces magic-number thresholds with
 * posterior probability statements. Pure math, no deps.
 *
 * The self-model asks: "given f failures and s successes (plus a pooled prior), what is
 * P(true failure rate > t)?" — answered exactly with the regularized incomplete beta
 * function on a Beta(α, β) posterior, instead of `n >= 6 && rate >= 0.3`.
 */

/** Lanczos approximation of ln Γ(x). Accurate to ~1e-13 for x > 0. */
export function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula keeps small arguments accurate.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < g.length; i++) a += g[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued-fraction evaluation for the incomplete beta (Lentz's method). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-12;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b) = P(X ≤ x) for X ~ Beta(a, b). */
export function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lnBt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(θ > t) for θ ~ Beta(alpha, beta) — the posterior tail used for weak-spot decisions. */
export function betaTailProb(t: number, alpha: number, beta: number): number {
  return 1 - regIncBeta(t, alpha, beta);
}

/** Posterior mean of Beta(alpha, beta). */
export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/**
 * Wilson score interval for a (possibly weighted) proportion — the small-n-honest
 * confidence interval the calibration escalation uses instead of a fixed gap threshold.
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/**
 * Isotonic regression via Pool-Adjacent-Violators: the monotone, non-parametric
 * reliability curve (stated confidence → observed accuracy) with no bin-boundary
 * artifacts. Input points must be sorted by x; weights default to 1.
 */
export function isotonicFit(points: { x: number; y: number; w?: number }[]): { x: number; yhat: number }[] {
  if (points.length === 0) return [];
  // Each block holds a pooled mean; adjacent violators (mean decreasing) merge.
  const blocks = points.map(p => ({ sum: p.y * (p.w ?? 1), w: p.w ?? 1, xs: [p.x] }));
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].sum / blocks[i].w > blocks[i + 1].sum / blocks[i + 1].w + 1e-12) {
      blocks[i].sum += blocks[i + 1].sum;
      blocks[i].w += blocks[i + 1].w;
      blocks[i].xs.push(...blocks[i + 1].xs);
      blocks.splice(i + 1, 1);
      if (i > 0) i--; // a merge can create a new violation to the LEFT
    } else {
      i++;
    }
  }
  const out: { x: number; yhat: number }[] = [];
  for (const b of blocks) {
    const yhat = b.sum / b.w;
    for (const x of b.xs) out.push({ x, yhat });
  }
  return out;
}

/** Expected Calibration Error over weighted bins: Σ (w_b/W)·|conf_b − acc_b|. */
export function expectedCalibrationError(bins: { conf: number; acc: number; w: number }[]): number {
  const W = bins.reduce((a, b) => a + b.w, 0);
  if (W <= 0) return 0;
  return bins.reduce((a, b) => a + (b.w / W) * Math.abs(b.conf - b.acc), 0);
}
