/**
 * Cleaner phone numbers: one stored format (E.164, e.g. "+13055550123"),
 * and the only two ways one is ever shown — in full (to a
 * `cleaners:manage` holder) or masked to its last 4 digits (everyone
 * else, and every audit entry). Masking is decided on the server; see
 * toCleanerView() in cleaners.service.ts.
 */

const ALLOWED_PHONE_CHARACTERS = /^\+?[\d\s().-]+$/;

/**
 * Normalizes what a person typed into E.164, or null if it isn't a usable
 * number. A bare 10-digit number (or 11 digits starting with 1) is treated
 * as US/Canada (+1); anything else must be entered with its "+" country
 * code. Never guesses beyond that.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!ALLOWED_PHONE_CHARACTERS.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0")
      ? `+${digits}`
      : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function phoneLast4(phone: string): string {
  return phone.replace(/\D/g, "").slice(-4);
}

export function maskPhone(phone: string): string {
  return `•••• ${phoneLast4(phone)}`;
}

/** "+13055550123" → "(305) 555-0123"; any other country stays in E.164. */
export function formatPhone(phone: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : phone;
}
