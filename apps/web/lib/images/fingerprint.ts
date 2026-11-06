export async function fingerprint(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
