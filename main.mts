import { type AnyColor, colordx, oklabDeltaE } from "@colordx/core";
import { inGamutP3 } from "@colordx/core/plugins/p3";
import { inGamutRec2020 } from "@colordx/core/plugins/rec2020";

const SEARCH_ITERATIONS = 50;

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
        let mid = (lo + hi) / 2;
        if (inGamut(build(lightness, mid, hue))) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * For a given hue, find the maximum in-gamut chroma and lightness combination.
 * Visually, this is peak of the lightness triangle.
 */
function findPeakGamut(
    inGamut: (color: ReturnType<typeof build>) => boolean,
    hue: number,
): { chroma: number; lightness: number } {
    const cMax = getMaxC();
    let lo = 0;
    let hi = L_MAX_COLOR;
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        let m1 = lo + (hi - lo) / 3;
        let m2 = hi - (hi - lo) / 3;
        if (maxChroma(inGamut, m1, cMax, hue) < maxChroma(inGamut, m2, cMax, hue)) {
            lo = m1;
        } else {
            hi = m2;
        }
    }
    const peakLightness = (lo + hi) / 2 / L_MAX_COLOR;
    let peakChroma = maxChroma(inGamut, peakLightness * L_MAX_COLOR, cMax, hue);
    while (!inGamut(build(peakLightness * L_MAX_COLOR, peakChroma, hue))) {
        peakChroma -= 0.0001;
    }
    console.log("Peak found:", { chroma: peakChroma, lightness: peakLightness });
    return { chroma: peakChroma, lightness: peakLightness };
}
