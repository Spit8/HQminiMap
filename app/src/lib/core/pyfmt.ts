/**
 * Python-compatible number formatting ("{:.Nf}" / "{:.Ng}"), so the Lua files written by the app
 * are byte-identical to the miniMapper reference generator (gen_mosaic_cutscene.py).
 * Like Python, rounding is done on the exact binary value, ties to even.
 */

function isNegZero(v: number): boolean {
  return v === 0 && 1 / v < 0;
}

/**
 * Exact decimal digits of |a| rounded half-even to `frac` decimals (frac may be negative).
 * Returns the digit string (no leading zeros except a single "0") and the decimal point position.
 */
function roundExact(a: number, frac: number): { digits: string; point: number } {
  const full = a.toFixed(100); // exact expansion for |a| < 1e21 (doubles have ≤ ~60 frac digits here)
  const [ip, fp] = full.split(".");
  let digits = ip + fp;
  let point = ip.length;
  const keep = point + frac;
  if (keep < 0) return { digits: "0", point: 1 };
  const head = digits.slice(0, keep);
  const rest = digits.slice(keep);
  let up = false;
  if (rest.length && rest[0] >= "5") {
    const tail = rest.slice(1);
    if (rest[0] > "5" || /[1-9]/.test(tail)) up = true;
    else up = head.length > 0 && Number(head[head.length - 1]) % 2 === 1; // exact tie → even
  }
  let d = head.split("");
  if (up) {
    let k = d.length - 1;
    while (k >= 0 && d[k] === "9") d[k--] = "0";
    if (k >= 0) d[k] = String(Number(d[k]) + 1);
    else { d.unshift("1"); point++; }
  }
  // Pad when frac < 0 (rounding to tens…): digits up to the point are zeros.
  while (d.length < point) d.push("0");
  digits = d.join("");
  // Strip leading zeros of the integer part.
  let lead = 0;
  while (lead < point - 1 && digits[lead] === "0") lead++;
  return { digits: digits.slice(lead), point: point - lead };
}

function nonFinite(v: number): string {
  return v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
}

/** Python format(v, ".{p}f"). */
export function fmtF(v: number, p: number): string {
  if (!Number.isFinite(v)) return nonFinite(v);
  const sign = v < 0 || isNegZero(v) ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e21) return sign + a.toFixed(p);
  const { digits, point } = roundExact(a, p);
  const ip = digits.slice(0, point) || "0";
  const fp = digits.slice(point).padEnd(p, "0").slice(0, p);
  return sign + (p > 0 ? `${ip}.${fp}` : ip);
}

/** Python format(v, ".{p}g"): p significant digits, trailing zeros stripped. */
export function fmtG(v: number, p: number): string {
  if (!Number.isFinite(v)) return nonFinite(v);
  if (p === 0) p = 1;
  const sign = v < 0 || isNegZero(v) ? "-" : "";
  const a = Math.abs(v);
  if (a === 0) return sign + "0";
  // Decimal exponent of the value rounded to p significant digits.
  let exp = Math.floor(Math.log10(a));
  if (a < 10 ** exp) exp--; // log10 imprecision guard
  else if (a >= 10 ** (exp + 1)) exp++;
  let r = roundExact(a, p - 1 - exp);
  const sig = () => r.digits.replace(/^0+/, "");
  if (sig().length > p && /^10*$/.test(sig())) {
    // Rounded up to the next power of ten.
    exp++;
    r = roundExact(a, p - 1 - exp);
  }
  const s = sig().padEnd(p, "0").slice(0, p);
  const strip = (x: string) => (x.includes(".") ? x.replace(/0+$/, "").replace(/\.$/, "") : x);
  if (exp >= -4 && exp < p) {
    let out: string;
    if (exp >= 0) out = `${s.slice(0, exp + 1)}.${s.slice(exp + 1)}`;
    else out = `0.${"0".repeat(-exp - 1)}${s}`;
    return sign + strip(out);
  }
  const mant = strip(`${s[0]}.${s.slice(1)}`);
  const e = Math.abs(exp);
  return `${sign}${mant}e${exp < 0 ? "-" : "+"}${e < 10 ? "0" + e : e}`;
}
