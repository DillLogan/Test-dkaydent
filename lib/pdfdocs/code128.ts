/** Code 128 (set B, with set C for runs of digits) as bar widths. Returns module widths alternating bar/space, starting with a bar. */
const P = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106;

export function code128(text: string): number[] | null {
  const s = String(text ?? "");
  if (!s) return null;
  for (const ch of s) if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) > 126) return null;
  const codes: number[] = [];
  let i = 0;
  const digitsAt = (k: number) => { let n = 0; while (k + n < s.length && s[k + n] >= "0" && s[k + n] <= "9") n++; return n; };
  let set: "B" | "C" = digitsAt(0) >= 4 && digitsAt(0) % 2 === 0 ? "C" : "B";
  codes.push(set === "C" ? START_C : START_B);
  while (i < s.length) {
    const d = digitsAt(i);
    if (set === "B" && d >= 6) { const even = d - (d % 2); if (even >= 6) { codes.push(CODE_C); set = "C"; } }
    if (set === "C") {
      if (digitsAt(i) >= 2) { codes.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      codes.push(CODE_B); set = "B";
    }
    codes.push(s.charCodeAt(i) - 32); i++;
  }
  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103, STOP);
  return codes.flatMap((c) => P[c].split("").map(Number));
}
