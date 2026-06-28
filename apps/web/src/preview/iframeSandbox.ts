// Security-critical iframe contract for trusted Previews (ADR-0016).
//
// A trusted Preview renders from its own `http://127.0.0.1:<allocated-port>`
// origin — a different origin from the cockpit, so the Same-Origin Policy is the
// primary isolation boundary. These attributes are the defense-in-depth layer on
// top of that boundary. Never grant `allow-top-navigation`, `allow-popups`, or
// `allow-modals`, never delegate powerful features via `allow`, and never pass a
// Hub cookie, token, or credential into the frame.
//
// `allow-scripts` + `allow-same-origin` is safe here precisely because the frame
// is cross-origin to the embedder (the sandbox-escape only applies to frames that
// are same-origin with their parent).
export const TRUSTED_PREVIEW_SANDBOX =
  "allow-scripts allow-forms allow-same-origin";
export const TRUSTED_PREVIEW_REFERRER_POLICY = "no-referrer" as const;
export const TRUSTED_PREVIEW_ALLOW = "";
