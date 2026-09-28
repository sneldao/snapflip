// Owner: A. Pure title-matching helpers shared by the watch pings and tests. No imports.
export function normTitle(s: string): string {
  // Fold accents first so vision's "Pokémon" matches the catalog's "Pokemon".
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const STOP = new Set([
  "the", "legend", "version", "game", "games", "boy", "color", "colour", "advance",
  "super", "edition", "deluxe", "nintendo", "gbc", "eur", "pal", "ntsc", "usa", "snes", "n64",
]);

/** The words that make a title recognisably the same game: ≥4 chars, minus filler/platform tokens. */
export function seriesTokens(title: string): string[] {
  return normTitle(title).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
}

/** Whole-word substring match after dropping a leading "the legend of " from both sides. */
export function titleCovers(watchTitle: string, skuTitle: string): boolean {
  const strip = (s: string) => normTitle(s).replace(/^the legend of /, "");
  const big = ` ${strip(watchTitle)} `;
  const small = ` ${strip(skuTitle)} `;
  return big.includes(small);
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
