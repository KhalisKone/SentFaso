/** Empreinte SHA-256 (fichiers déposés par le citoyen). */
export async function sha256(entree) {
  const octets = typeof entree === "string" ? new TextEncoder().encode(entree) : entree;
  if (globalThis.crypto?.subtle) {
    const b = await crypto.subtle.digest("SHA-256", octets);
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  // Contexte non sécurisé (HTTP hors localhost) : empreinte de secours, non cryptographique.
  let h = 0x811c9dc5;
  const s = typeof entree === "string" ? entree : String(entree.byteLength);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(64, "0");
}
