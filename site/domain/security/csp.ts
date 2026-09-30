/**
 * CSP policy for public HTML documents. Pure and deterministic per mode so
 * the edge-cached HTML keeps a stable header (no per-request nonces here).
 *
 * Report-only ships first: the strict draft below only REPORTS violations
 * through the /.well-known/csp-report endpoint. Enforcement stays off until
 * collected reports justify each relaxation (hash rewrites for inline
 * scripts etc.) — never a blanket unsafe-inline/unsafe-eval.
 */

export type CspMode = "off" | "report-only" | "enforce";

export const CSP_REPORT_PATH = "/.well-known/csp-report";

export const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Mermaid/KaTeX/Vditor inject dynamic styles; revisited after violation data
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export function cspModeLabel(value: string | undefined): CspMode {
  return value === "enforce" ? "enforce" : value === "report-only" ? "report-only" : "off";
}

export function cspHeaderFor(mode: CspMode): { name: string; value: string } | null {
  if (mode === "off") return null;
  return mode === "enforce"
    ? { name: "Content-Security-Policy", value: CSP_POLICY }
    : { name: "Content-Security-Policy-Report-Only", value: `${CSP_POLICY}; report-uri ${CSP_REPORT_PATH}` };
}

export function summarizeCspReport(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const report = (payload as { "csp-report"?: unknown })["csp-report"];
  if (!report || typeof report !== "object") return null;
  const fields = report as Record<string, unknown>;
  const rawDirective = fields["effective-directive"] ?? fields["violated-directive"];
  if (typeof rawDirective !== "string") return null;
  const directive = rawDirective.split(/\s/, 1)[0];
  if (!/^[a-z-]{1,40}$/.test(directive)) return null;

  const blocked = fields["blocked-uri"];
  let blockedOrigin = "unknown";
  if (typeof blocked === "string") {
    if (["inline", "eval", "data", "blob"].includes(blocked)) blockedOrigin = blocked;
    else {
      try {
        const url = new URL(blocked);
        if (url.protocol === "https:" || url.protocol === "http:") blockedOrigin = url.origin.slice(0, 200);
      } catch { /* An invalid blocked URI contributes no log detail. */ }
    }
  }
  const statusCode = fields["status-code"];
  return {
    directive,
    blockedOrigin,
    ...(typeof statusCode === "number" && Number.isInteger(statusCode)
      && statusCode >= 100 && statusCode <= 599 ? { statusCode } : {}),
  };
}
