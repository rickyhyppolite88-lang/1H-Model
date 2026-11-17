// Public verifier only. The private entry token is never published in source.
export const adminEntryDigest =
  "b75831f55fff2246cbff6af9a21f9ae546b65a231ffd5b8f2114f495e97517ed";

export async function verifyAdminEntry(fragment: string) {
  const match = /^#admin=([A-Za-z0-9_-]{32})$/.exec(fragment);
  if (!match) return false;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(match[1]),
  );
  return (
    Array.from(new Uint8Array(bytes), (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("") === adminEntryDigest
  );
}
