const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateSessionCode(randomValues?: Uint32Array): string {
  const values = randomValues ?? crypto.getRandomValues(new Uint32Array(6));
  if (values.length < 6) {
    throw new Error("Six random values are required for a session code");
  }
  const characters = Array.from(
    { length: 6 },
    (_, index) => SESSION_CODE_ALPHABET[(values[index] ?? 0) % SESSION_CODE_ALPHABET.length],
  );
  return `${characters.slice(0, 3).join("")}-${characters.slice(3).join("")}`;
}

export function normalizeSessionCode(value: string): string {
  const compact = value
    .toUpperCase()
    .replaceAll(/[^A-Z2-9]/g, "")
    .replaceAll(/[IO01]/g, "")
    .slice(0, 6);
  return compact.length > 3 ? `${compact.slice(0, 3)}-${compact.slice(3)}` : compact;
}

export function isCompleteSessionCode(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(value);
}
