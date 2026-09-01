import { describe, expect, it } from "vitest";
import { heightAt } from "./terrain";

/**
 * The §3 refactor's proof. These are the heights the shipped terrain produced before
 * `terrain.ts` became a factory, captured to full double precision. Moving the field size,
 * cell count, tee, cup and noise seed from module constants onto a HoleSpec must not move a
 * single one of them -- otherwise the data-model change and the §4 terrain change land
 * together with no way to attribute a regression.
 *
 * Deleted with the fixture once §4 lands and the heights legitimately change.
 */
const AXIS = [-70, -50, -30, -10, 10, 30, 50, 70];

const LEGACY_HEIGHTS: readonly string[] = [
  "8.32588429257804102e-2",
  "5.46452323038275956e-1",
  "-4.21554331355841055e-2",
  "2.62191761495142672e-1",
  "-2.38351674495033167e-1",
  "-2.59969169594922611e-1",
  "7.90176255047333242e-1",
  "-3.03827391745498341e-8",
  "-5.99318750634712072e-1",
  "-6.49825606658963467e-2",
  "-3.29924486226930158e-1",
  "-3.06290055617900903e-1",
  "1.02817869833238887e-1",
  "1.41270125754916626e-1",
  "1.81691427164171249e-1",
  "-2.86365810035257573e-1",
  "3.63974584747615126e-1",
  "6.19824538653735324e-1",
  "3.76340871013191247e-1",
  "-2.58834095582955226e-1",
  "3.48961026988531153e-1",
  "-3.87874750400407087e-1",
  "1.14712101030962507e-1",
  "-4.94524775745658063e-2",
  "-8.09897926746471764e-1",
  "-2.70607254166948585e-1",
  "3.25380843203356473e-1",
  "-3.66673633865023885e-1",
  "1.93851590348309233e-1",
  "-3.86528183601593300e-1",
  "-5.40193780723743702e-2",
  "6.66961283465414501e-1",
  "3.36524920856312859e-1",
  "-7.62794803516377712e-2",
  "-1.32937320282409205e-1",
  "-4.60891377437908312e-1",
  "2.31134148233404280e-1",
  "-3.53229056686410137e-1",
  "4.89903238229336679e-1",
  "2.45323515505427914e-1",
  "-3.37707376502314305e-1",
  "-1.89764489674002709e-2",
  "-4.42915567235042440e-1",
  "5.30185013578258757e-1",
  "4.12315531444811645e-1",
  "-5.36598385865336147e-2",
  "3.24931598922210241e-1",
  "3.81857961739548335e-1",
  "3.19103528749893395e-1",
  "-2.35334755955447367e-1",
  "1.12088787535809545e-1",
  "-7.91882777066137744e-1",
  "-3.53559826075052347e-2",
  "-5.00135419239418400e-1",
  "-1.74817085842916831e-1",
  "-3.71470921632382545e-1",
  "5.28189661148838613e-2",
  "5.79523560575247454e-2",
  "8.25162197962936328e-1",
  "1.66488756888425432e-1",
  "5.65800510009589863e-1",
  "2.26483336287011200e-1",
  "-9.21961849198580791e-2",
  "2.92140021181368836e-1",
  "5.64763787381927340e-1",
  "-1.30919333336054877e-1",
];

describe("terrain refactor is behaviour-preserving", () => {
  it("reproduces every recorded height exactly", () => {
    const actual: string[] = [];
    for (const x of AXIS) {
      for (const z of AXIS) actual.push(heightAt(x, z).toExponential(17));
    }
    actual.push(heightAt(-68, 0).toExponential(17));
    actual.push(heightAt(55, 8).toExponential(17));
    expect(actual).toEqual(LEGACY_HEIGHTS);
  });

  it("recorded 66 samples", () => {
    expect(LEGACY_HEIGHTS).toHaveLength(66);
  });
});
