const WEB_SLOT_SESSION_KEY = "shader-studio.web-layout-slot";
const WEB_SLOT_CLAIMS_KEY = "shader-studio.web-layout-claims";
const WEB_SLOT_STALE_MS = 5 * 60 * 1000;

interface WebLayoutClaims {
  [slot: string]: number;
}

function getNow(): number {
  return Date.now();
}

function readClaims(): WebLayoutClaims {
  try {
    const raw = localStorage.getItem(WEB_SLOT_CLAIMS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as WebLayoutClaims;
  } catch {
    return {};
  }
}

function writeClaims(claims: WebLayoutClaims): void {
  try {
    localStorage.setItem(WEB_SLOT_CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    // Best-effort only. Layout slot fallback still works within the current tab session.
  }
}

function pruneStaleClaims(claims: WebLayoutClaims, now = getNow()): WebLayoutClaims {
  return Object.fromEntries(
    Object.entries(claims).filter(([, timestamp]) => now - timestamp < WEB_SLOT_STALE_MS),
  );
}

export function getInjectedLayoutSlot(): string | null {
  if (typeof document === "undefined") return null;
  return document
    .querySelector('meta[name="shader-studio-layout-slot"]')
    ?.getAttribute("content") ?? null;
}

export function allocateWebLayoutSlot(): string {
  if (typeof window === "undefined") {
    return "web:1";
  }

  const existingSlot = sessionStorage.getItem(WEB_SLOT_SESSION_KEY);
  const now = getNow();
  const claims = pruneStaleClaims(readClaims(), now);

  if (existingSlot) {
    claims[existingSlot] = now;
    writeClaims(claims);
    return existingSlot;
  }

  let index = 1;
  while (claims[`web:${index}`]) {
    index++;
  }

  const slot = `web:${index}`;
  claims[slot] = now;
  writeClaims(claims);
  sessionStorage.setItem(WEB_SLOT_SESSION_KEY, slot);
  return slot;
}

export function releaseWebLayoutSlot(): void {
  if (typeof window === "undefined") return;

  const slot = sessionStorage.getItem(WEB_SLOT_SESSION_KEY);
  if (!slot) return;

  const claims = readClaims();
  delete claims[slot];
  writeClaims(claims);
  sessionStorage.removeItem(WEB_SLOT_SESSION_KEY);
}
