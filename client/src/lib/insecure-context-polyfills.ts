/**
 * Polyfills for NON-SECURE contexts (plain http:// on an IP — e.g. the
 * DigitalOcean droplet before a domain/HTTPS exists). Browsers only expose
 * crypto.randomUUID in secure contexts, so the bundle crashed at boot on
 * http://104.248.127.195 (2026-09-23). getRandomValues IS available
 * everywhere, so a spec-correct v4 UUID fallback is safe. Harmless no-op
 * under HTTPS/localhost. Must be the FIRST import of the entry module.
 */
if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID !== "function") {
  (crypto as any).randomUUID = (): string => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
  };
}

export {};
