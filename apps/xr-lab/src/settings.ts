import type { HubConnectionConfig } from "./hubClient";

const HUB_URL_KEY = "aspex.xr-lab.hub-url";
const HUB_TOKEN_KEY = "aspex.xr-lab.hub-token";
const DEFAULT_HUB_URL = "http://127.0.0.1:4317";

export class PairingSettings {
  private current: HubConnectionConfig | null = null;

  constructor(
    private persistent: Pick<Storage, "getItem" | "setItem"> = localStorage,
    private secrets: Pick<
      Storage,
      "getItem" | "setItem" | "removeItem"
    > = sessionStorage,
  ) {
    this.reload();
  }

  get(): HubConnectionConfig | null {
    return this.current === null ? null : { ...this.current };
  }

  save(hubUrl: string, token: string): HubConnectionConfig {
    const url = normalizeHubUrl(hubUrl);
    const secret = token.trim();
    if (secret === "") {
      throw new Error("A Hub bearer token is required.");
    }
    this.persistent.setItem(HUB_URL_KEY, url);
    this.secrets.setItem(HUB_TOKEN_KEY, secret);
    this.current = { hubUrl: url, token: secret };
    return { ...this.current };
  }

  clearToken(): void {
    this.secrets.removeItem(HUB_TOKEN_KEY);
    this.current = null;
  }

  private reload(): void {
    const hubUrl = this.persistent.getItem(HUB_URL_KEY) ?? DEFAULT_HUB_URL;
    const token = this.secrets.getItem(HUB_TOKEN_KEY)?.trim() ?? "";
    this.current = token === "" ? null : { hubUrl, token };
  }
}

export function normalizeHubUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Hub URL must use http or https.");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}
