import { MIN_PASSWORD_LENGTH } from "./encryptedToken";

// The hint under Copy link with password…'s field (loads with that dialog, not with the app).

export type PasswordLevel = "short" | "weak" | "fair" | "strong";

/** A few of the most-guessed passwords and words (lowercase, digits and symbols stripped). */
const COMMON = new Set(
  (
    "password passw0rd qwerty qwertyuiop asdfgh asdfghjkl letmein welcome iloveyou admin administrator " +
    "monkey dragon football baseball sunshine princess master shadow superman trustno changeme secret " +
    "diagram diagrams livediagrams abcdefgh abcdefg abcdef"
  ).split(" "),
);

/**
 * A rough guess at how hard a password is to guess, for the hint under the field. The link is open to
 * unlimited offline guessing by whoever holds it, so length (several random words) matters most.
 */
export function passwordStrength(password: string): { level: PasswordLevel; hint: string } {
  const pw = password.normalize("NFC");
  const chars = [...pw];
  if (chars.length < MIN_PASSWORD_LENGTH)
    return { level: "short", hint: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  const letters = pw.toLowerCase().replace(/[^a-z]/g, "");
  const distinct = new Set(chars).size;
  const sequential = "abcdefghijklmnopqrstuvwxyz01234567890".includes(pw.toLowerCase());
  const commonCore = COMMON.has(letters) || COMMON.has(pw.toLowerCase());
  const digitsOnly = /^\d+$/.test(pw);
  // One word with a number or symbol tacked on ("Summer2026!").
  const wordPlus = /^[A-Za-z]+[\d\W_]{0,6}$/.test(pw) && chars.length < 14;
  if (commonCore || sequential || distinct <= 3 || (digitsOnly && chars.length < 16) || wordPlus)
    return { level: "weak", hint: "Easy to guess. Try four or more random words." };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const words = pw.split(/[\s\-_.,+]+/).filter((w) => w.length >= 3).length;
  const bits = Math.min(chars.length * Math.log2(Math.max(pool, 10)), distinct * 8);
  if ((words >= 4 && chars.length >= 20) || bits >= 80) return { level: "strong", hint: "Strong." };
  if (bits >= 50) return { level: "fair", hint: "Fair. Longer is stronger: try four or more random words." };
  return { level: "weak", hint: "Easy to guess. Try four or more random words." };
}
