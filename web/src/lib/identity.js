// Device-paired identity. The library code IS the user — there is no
// signup, no email. On first load the app reads localStorage; if the slot
// is empty it generates a UUID via crypto.randomUUID (Web Crypto, available
// in every browser we ship to) and persists it. The same code is later
// pasted into the Figma plugin's pairing screen.
//
// The user can swap codes via the import flow in the PairingPanel — useful
// for moving libraries across devices.

const KEY = "libraryCode";

function safeRandomUUID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Last-resort fallback for ancient browsers — adequate uniqueness for
  // our usage even without a CSPRNG.
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

export function getLibraryCode() {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 8) return existing;
  } catch {
    /* localStorage blocked — fall through to in-memory only */
  }
  const fresh = safeRandomUUID();
  try {
    localStorage.setItem(KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}

export function setLibraryCode(code) {
  const clean = String(code || "").trim();
  if (clean.length < 8 || clean.length > 64) {
    throw new Error("library code must be 8–64 characters");
  }
  if (!/^[A-Za-z0-9-]+$/.test(clean)) {
    throw new Error("library code may only contain letters, digits, and dashes");
  }
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    /* ignore */
  }
  return clean;
}
