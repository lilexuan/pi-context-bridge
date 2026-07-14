import crypto from "node:crypto";

export function isAuthorized(header: string | undefined, expectedToken: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
