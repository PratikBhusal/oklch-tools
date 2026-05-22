import { type AnyColor, colordx, oklabDeltaE } from "@colordx/core";
import { inGamutP3 } from "@colordx/core/plugins/p3";
import { inGamutRec2020 } from "@colordx/core/plugins/rec2020";
// import { parseHslStringUnclamped } from "@colordx/core/colorModels/hsl";

const SEARCH_ITERATIONS = 5000;
const BINARY_SEARCH_ITERATIONS = 60;

enum MaximumChroma {
    DisplayP3 = 0.37,
    REC2020 = 0.47,
}

function build(lightness: number, chroma: number, hue: number): OklchColorInput {
    return { l: lightness, c: chroma, h: hue };
}

function round(color: OklchColorInput): OklchColorInput {
    return {
        l: parseFloat(color.l.toFixed(6)),
        c: parseFloat(color.c.toFixed(6)),
        h: parseFloat(color.h.toFixed(4)),
    };
}

/**
 * Binary search for the highest chroma in [0, c] that stays within the given
 * gamut at L and H.
 */
function maxChroma(
    inGamut: (input: AnyColor) => boolean,
    lightness: number,
    chroma: number,
    hue: number,
): number {
    let lo = 0;
    let hi = chroma;
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        let mid = lo + (hi - lo) / 2;
        if (inGamut(build(lightness, mid, hue))) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    while (!inGamut(build(lightness, lo, hue))) {
        // Scales relative to magnitude, stepping by 1-2 units in the last
        // place. Subtraction by Number.EPSILON would overshoot for small values
        // and undershoot for large ones, since Number.EPSILON is the unit in
        // the last place at 1.0, not at peakChroma.
        //
        // For example, at peakChroma = 0.19:
        //
        //   *= (1 - EPSILON) steps down to 0.18999999999999995
        //   -= EPSILON       steps down to 0.18999999999999978
        lo *= 1 - Number.EPSILON;
    }
    return lo;
}

/**
 * Binary search for the lowest lightness in [0, 1] at a given chroma and hue
 * that stays within the given gamut.
 */
function minLightness(inGamut: (input: AnyColor) => boolean, chroma: number, hue: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        let mid = lo + (hi - lo) / 2;
        if (inGamut(build(mid, chroma, hue))) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    while (!inGamut(build(hi, chroma, hue))) {
        hi += hi * Number.EPSILON;
    }
    return hi;
}

/**
 * For a given hue, find the maximum in-gamut chroma and lightness combination.
 * Visually, this is peak of the lightness triangle.
 */
function findPeakGamut(
    inGamut: (input: AnyColor) => boolean,
    cMax: number,
    hue: number,
): OklchColorInput {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        let m1 = lo + (hi - lo) / 3;
        let m2 = hi - (hi - lo) / 3;
        if (maxChroma(inGamut, m1, cMax, hue) < maxChroma(inGamut, m2, cMax, hue)) {
            lo = m1;
        } else {
            hi = m2;
        }
    }
    const peakLightness = lo + (hi - lo) / 2;
    let peakChroma = maxChroma(inGamut, peakLightness, cMax, hue);
    while (!inGamut(build(peakLightness, peakChroma, hue))) {
        // Scales relative to magnitude, stepping by 1-2 units in the last
        // place. Subtraction by Number.EPSILON would overshoot for small values
        // and undershoot for large ones, since Number.EPSILON is the unit in
        // the last place at 1.0, not at peakChroma.
        //
        // For example, at peakChroma = 0.19:
        //
        //   *= (1 - EPSILON) steps down to 0.18999999999999995
        //   -= EPSILON       steps down to 0.18999999999999978
        peakChroma *= 1 - Number.EPSILON;
    }
    return { l: peakLightness, c: peakChroma, h: hue };
}

function findPeakGamutInHueRange(
    inGamut: (input: AnyColor) => boolean,
    lightness: number,
    cMax: number,
    hMin: number,
    hMax: number,
): OklchColorInput {
    let lo = hMin;
    let hi = hMax;
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        let m1 = lo + (hi - lo) / 3;
        let m2 = hi - (hi - lo) / 3;
        if (maxChroma(inGamut, lightness, cMax, m1) < maxChroma(inGamut, lightness, cMax, m2)) {
            lo = m1;
        } else {
            hi = m2;
        }
    }
    const peakHue = lo + (hi - lo) / 2;
    let peakChroma = maxChroma(inGamut, lightness, cMax, peakHue);
    while (!inGamut(build(lightness, peakChroma, peakHue))) {
        // Scales relative to magnitude, stepping by 1-2 units in the last
        // place. Subtraction by Number.EPSILON would overshoot for small values
        // and undershoot for large ones, since Number.EPSILON is the unit in
        // the last place at 1.0, not at peakChroma.
        //
        // For example, at peakChroma = 0.19:
        //
        //   *= (1 - EPSILON) steps down to 0.18999999999999995
        //   -= EPSILON       steps down to 0.18999999999999978
        peakChroma *= 1 - Number.EPSILON;
    }
    return { l: lightness, c: peakChroma, h: peakHue };
}

function listWithinGamut(
    inGamut: (input: AnyColor) => boolean,
    maxPossibleChroma: number,
    lMin: number,
    lMax: number,
    cMin: number,
    cMax: number,
    hMin: number,
    hMax: number,
    precision: number = 0.0001,
): void {
    // Index-based to avoid floating-point drift from repeated += increments.
    for (let i = 0; ; i++) {
        const c = cMax - i * precision;
        if (c < cMin - 1e-9) break;
        for (let j = 0; ; j++) {
            const l = lMin + j * precision * 10;
            if (l > lMax + 1e-9) break;
            for (let k = 0; ; k++) {
                const h = hMin + k * precision * 100;
                if (h > hMax + 1e-9) break;
                if (inGamut(build(l, c, h))) {
                    console.log(
                        `oklch(${parseFloat(l.toFixed(3))} ${parseFloat(c.toFixed(4))} ${parseFloat(h.toFixed(2))})`,
                    );
                }
            }
        }
    }
}

/**
 * Find the closest color within a gamut to an out-of-gamut target, minimizing
 * Oklab delta-E (Euclidean distance in Oklab space).
 *
 * Algorithm: two-phase grid search on the gamut boundary surface.
 *
 * Since the target is outside the gamut, the closest in-gamut point lies on the
 * gamut boundary. In OKLCH coordinates, the boundary for a given (L, H) pair is
 * the maximum chroma that remains in-gamut. This reduces the 3D problem to a 2D
 * search over L and H, with C determined by `maxChroma`.
 *
 * The caller may constrain the lightness search to [lMin, lMax] (defaults to
 * [0, 1]). When lMin === lMax, lightness is fixed and only H is searched.
 *
 * Phase 1 — Coarse grid: evaluates a dense grid of L × H values across the
 * lightness range to locate the basin containing the global minimum.
 *
 * Phase 2 — Iterative refinement: re-centers a smaller grid on the current
 * best (L, H) and shrinks the search radius by half each pass, converging to
 * float64 precision.
 *
 * This uses multi-resolution grid search rather than a traditional Nelder-Mead.
 * Nelder-Mead deforms a simplex of 3 points to chase the minimum, converging in
 * far fewer evaluations, but can get trapped in local minima or stall on flat
 * regions. The grid approach is preferred here for robustness over speed.
 */
function closestInGamut(
    inGamut: (input: AnyColor) => boolean,
    cMax: number,
    target: OklchColorInput,
    lMin: number = 0,
    lMax: number = 1,
): OklchColorInput {
    if (inGamut(target)) {
        return target;
    }

    const deltaE = (candidate: OklchColorInput) => oklabDeltaE(colordx(target), colordx(candidate));

    // Total width of the coarse search window.
    // - L searches [lMin, lMax] (caller-specified, defaults to [0, 1]);
    // - H searches [target.h - 15, target.h + 15].
    const lRange = lMax - lMin;
    const hRange = 30;

    // Phase 1: sweep a uniform grid of L values over [lMin, lMax].
    // When lMin === lMax, coarseLSteps is 0 so the L loop runs once at that value.
    const coarseLSteps = lMin === lMax ? 0 : 500;
    const coarseHSteps = 500;
    let bestL = target.l;
    let bestH = target.h;
    let bestC = target.c;
    let bestDE = Infinity;
    let prevCoarseL = -1;
    for (let lightnessIndex = 0; lightnessIndex <= coarseLSteps; lightnessIndex++) {
        const l = coarseLSteps === 0 ? lMin : lMin + (lRange * lightnessIndex) / coarseLSteps;
        if (l === prevCoarseL) break;
        prevCoarseL = l;
        // For each L, sweep H values over [target.h - hRange/2, target.h + hRange/2].
        for (let hueIndex = 0; hueIndex <= coarseHSteps; hueIndex++) {
            const h =
                (((target.h - hRange / 2 + (hRange * hueIndex) / coarseHSteps) % 360) + 360) % 360;
            // Compute the gamut-boundary chroma and evaluate delta-E.
            const c = maxChroma(inGamut, l, cMax, h);
            const de = deltaE(build(l, c, h));
            if (de < bestDE) {
                bestDE = de;
                bestL = l;
                bestH = h;
            }
        }
    }

    let lRadius = coarseLSteps === 0 ? 0 : lRange / coarseLSteps;
    let hRadius = hRange / coarseHSteps;
    const refineSteps = 50;

    // Phase 2: re-center a smaller grid on the current best (L, H) and halve
    // the search radius each pass. This narrows in on the optimum beyond the
    // resolution of the coarse grid.
    // const refinePasses = 30;
    // for (let pass = 0; pass < refinePasses; pass++) {
    while (true) {
        const prevDE = bestDE;
        // Sweep L over [bestL - lRadius, bestL + lRadius], clamped to [lMin, lMax].
        let prevRefineL = -1;
        for (let lightnessIndex = 0; lightnessIndex <= refineSteps; lightnessIndex++) {
            const l =
                lMin === lMax
                    ? lMin
                    : Math.max(
                          lMin,
                          Math.min(
                              lMax,
                              bestL - lRadius + (2 * lRadius * lightnessIndex) / refineSteps,
                          ),
                      );
            if (l === prevRefineL) break;
            prevRefineL = l;
            // Sweep H over [bestH - hRadius, bestH + hRadius].
            for (let hueIndex = 0; hueIndex <= refineSteps; hueIndex++) {
                const h =
                    (((bestH - hRadius + (2 * hRadius * hueIndex) / refineSteps) % 360) + 360) %
                    360;
                const c = maxChroma(inGamut, l, cMax, h);
                const de = deltaE(build(l, c, h));
                if (de < bestDE) {
                    bestDE = de;
                    bestL = l;
                    bestC = c;
                    bestH = h;
                }
            }
        }
        lRadius /= 2;
        hRadius /= 2;
        if (Math.abs(prevDE - bestDE) < 1e-15) break;
    }

    return build(bestL, bestC, bestH);
}

/**
 * Like `closestInGamut`, but the result is quantized to at most `lDecimalPlaces`
 * digits on L, `cDecimalPlaces` digits on C, and `hDecimalPlaces` digits on H.
 *
 * The refinement loop exits early once the search radius drops below half the
 * corresponding precision step, since finer candidates would round to the same
 * output values. C is recomputed at the rounded (L, H) after the search and
 * stepped down by one unit in the last place if rounding pushed it out of gamut.
 */
function closestInGamutRounded(
    inGamut: (input: AnyColor) => boolean,
    cMax: number,
    target: OklchColorInput,
    lMin: number = 0,
    lMax: number = 1,
    lDecimalPlaces: number = 6,
    cDecimalPlaces: number = 6,
    hDecimalPlaces: number = 4,
): OklchColorInput {
    const roundTo = (value: number, places: number) => parseFloat(value.toFixed(places));

    const roundedTarget: OklchColorInput = {
        l: roundTo(target.l, lDecimalPlaces),
        c: roundTo(target.c, cDecimalPlaces),
        h: roundTo(target.h, hDecimalPlaces),
    };

    if (inGamut(roundedTarget)) {
        return roundedTarget;
    }

    const deltaE = (candidate: OklchColorInput) => oklabDeltaE(colordx(target), colordx(candidate));

    const lRange = lMax - lMin;
    const hRange = 30;

    const coarseLSteps = lMin === lMax ? 0 : 500;
    const coarseHSteps = 500;
    let bestL = target.l;
    let bestH = target.h;
    let bestDE = Infinity;
    let prevCoarseL = -1;
    for (let lightnessIndex = 0; lightnessIndex <= coarseLSteps; lightnessIndex++) {
        const l = coarseLSteps === 0 ? lMin : lMin + (lRange * lightnessIndex) / coarseLSteps;
        if (l === prevCoarseL) break;
        prevCoarseL = l;
        for (let hueIndex = 0; hueIndex <= coarseHSteps; hueIndex++) {
            const h =
                (((target.h - hRange / 2 + (hRange * hueIndex) / coarseHSteps) % 360) + 360) % 360;
            const c = maxChroma(inGamut, l, cMax, h);
            const de = deltaE(build(l, c, h));
            if (de < bestDE) {
                bestDE = de;
                bestL = l;
                bestH = h;
            }
        }
    }

    let lRadius = coarseLSteps === 0 ? 0 : lRange / coarseLSteps;
    let hRadius = hRange / coarseHSteps;
    const refineSteps = 50;

    const lStep = Math.pow(10, -lDecimalPlaces);
    const hStep = Math.pow(10, -hDecimalPlaces);
    while (true) {
        const prevDE = bestDE;
        let prevRefineL = -1;
        for (let lightnessIndex = 0; lightnessIndex <= refineSteps; lightnessIndex++) {
            const l =
                lMin === lMax
                    ? lMin
                    : Math.max(
                          lMin,
                          Math.min(
                              lMax,
                              bestL - lRadius + (2 * lRadius * lightnessIndex) / refineSteps,
                          ),
                      );
            if (l === prevRefineL) break;
            prevRefineL = l;
            for (let hueIndex = 0; hueIndex <= refineSteps; hueIndex++) {
                const h =
                    (((bestH - hRadius + (2 * hRadius * hueIndex) / refineSteps) % 360) + 360) %
                    360;
                const c = maxChroma(inGamut, l, cMax, h);
                const de = deltaE(build(l, c, h));
                if (de < bestDE) {
                    bestDE = de;
                    bestL = l;
                    bestH = h;
                }
            }
        }
        lRadius /= 2;
        hRadius /= 2;

        if (lRadius < lStep / 2 && hRadius < hStep / 2) break;
        if (Math.abs(prevDE - bestDE) < 1e-15) break;
    }

    const roundedL = roundTo(bestL, lDecimalPlaces);
    const roundedH = roundTo(bestH, hDecimalPlaces);
    let roundedC = roundTo(maxChroma(inGamut, roundedL, cMax, roundedH), cDecimalPlaces);
    const cStep = Math.pow(10, -cDecimalPlaces);
    while (roundedC > 0 && !inGamut(build(roundedL, roundedC, roundedH))) {
        roundedC = roundTo(roundedC - cStep, cDecimalPlaces);
    }
    return build(roundedL, roundedC, roundedH);
}

// const redHue: number = colordx("hsl(0 100% 50%)").toOklch(100).h;
// const yellowHue: number = colordx("hsl(60 100% 50%)").toOklch(100).h;
// console.log(yellowHue);
// const target: OklchColorInput = findPeakGamut(inGamutP3, MaximumChroma.DisplayP3, yellowHue);
// console.log(target);
// target.h = 107.43621863950031;

// // const target: OklchColorInput = { l: 0.75, c: 0.2, h: yellowHue };
// const target: OklchColorInput = {
//     l: 0.75,
//     c: 0.2,
//     h: 107.43621863950031,
// };
// // // const target = colordx("oklch(0.75 0.2 107.43621863950031)").toOklch(15);
// console.log("Target:  ", target);
// console.log("Target:  ", colordx(target).toOklchString());
// console.log("Target:  ", colordx(target).toOklchString(100));
// console.log("Target in gamut:", inGamutP3(target));
// // const closest = closestInGamutRounded(inGamutP3, MaximumChroma.DisplayP3, target);
// const closest = closestInGamut(inGamutP3, MaximumChroma.DisplayP3, target);
// const de = oklabDeltaE(colordx(target), colordx(closest));
// console.log("Closest Raw Value: ", closest);
// console.log("Closest: ", colordx(closest).toOklchString());
// console.log("Closest: ", colordx(closest).toOklchString(100));
// console.log("Closest: ", colordx(closest));
// console.log("Delta-E: ", de);
// console.log("closest in gamut:", inGamutP3(closest));
