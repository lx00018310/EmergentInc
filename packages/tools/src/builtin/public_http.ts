import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
const syntheticDns = new BlockList();
syntheticDns.addSubnet("198.18.0.0", 15, "ipv4");
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7],
  ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48],
] as const) blocked.addSubnet(address, prefix, "ipv6");

export class PublicHttpError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export interface PublicHttpResponse {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

async function resolveSyntheticDns(hostname: string, type: "A" | "AAAA"): Promise<{ address: string; family: 4 | 6 }[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", type);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { headers: { Accept: "application/dns-json" }, timeout: 5000 }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length > 16384) req.destroy(new PublicHttpError("DNS_ERROR", "DNS response too large"));
      });
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode !== 200 || data.Status !== 0) throw new Error("Public DNS lookup failed");
          const family = type === "A" ? 4 : 6;
          resolve((data.Answer || [])
            .filter((answer: any) => answer.type === (family === 4 ? 1 : 28) && isIP(answer.data) === family)
            .map((answer: any) => ({ address: answer.data as string, family })));
        } catch (err: any) { reject(new PublicHttpError("DNS_ERROR", err?.message || "Public DNS lookup failed")); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new PublicHttpError("DNS_ERROR", "Public DNS lookup timed out")));
    req.end();
  });
}

function parsePublicUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new PublicHttpError("INVALID_URL", "A valid absolute URL is required"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new PublicHttpError("INVALID_URL", "Only public HTTP(S) URLs without credentials are allowed");
  }
  return url;
}

async function publicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: { address: string; family: 4 | 6 }[];
  try {
    addresses = isIP(host)
      ? [{ address: host, family: isIP(host) as 4 | 6 }]
      : await lookup(host, { all: true, verbatim: true }) as { address: string; family: 4 | 6 }[];
  } catch (err: any) {
    throw new PublicHttpError("DNS_ERROR", err?.message || "DNS lookup failed");
  }
  // Some local proxies synthesize 198.18/15 DNS answers. Resolve the real public
  // address over HTTPS and pin the connection to it instead of trusting that range.
  if (isIP(host) === 0 && addresses.length && addresses.every(({ address, family }) =>
    family === 4 && syntheticDns.check(address, "ipv4"))) {
    addresses = await resolveSyntheticDns(host, "A");
    if (!addresses.length) addresses = await resolveSyntheticDns(host, "AAAA");
  }
  if (!addresses.length || addresses.some(({ address, family }) =>
    (family === 6 && address.toLowerCase().startsWith("::ffff:")) ||
    blocked.check(address, family === 4 ? "ipv4" : "ipv6"))) {
    throw new PublicHttpError("PRIVATE_ADDRESS", "Local, private, or reserved network addresses are not allowed");
  }
  return addresses[0];
}

function requestOnce(
  url: URL,
  address: { address: string; family: 4 | 6 },
  headers: Record<string, string>,
  maxBytes: number,
  signal?: AbortSignal
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = client(url, {
      method: "GET",
      headers: { "Accept-Encoding": "identity", ...headers },
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }]);
        else callback(null, address.address, address.family);
      },
      timeout: 10000,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400) {
        res.resume();
        resolve({ status, headers: res.headers, body: Buffer.alloc(0), truncated: false });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      let truncated = false;
      res.on("data", (chunk: Buffer) => {
        const remaining = maxBytes - bytes;
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        bytes += chunk.length;
        if (bytes > maxBytes) {
          truncated = true;
          res.destroy();
        }
      });
      res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on("close", () => {
        if (truncated) resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated });
      });
      res.on("error", (err) => { if (!truncated) reject(err); });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new PublicHttpError("TIMEOUT", "HTTP request timed out")));
    const onAbort = () => req.destroy(new PublicHttpError("ABORTED", "HTTP request stopped"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    if (signal?.aborted) onAbort();
    else req.end();
  });
}

export async function requestPublicText(
  rawUrl: string,
  options: { headers?: Record<string, string>; maxBytes?: number; signal?: AbortSignal } = {}
): Promise<PublicHttpResponse> {
  let url = parsePublicUrl(rawUrl);
  const maxBytes = options.maxBytes || 262144;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const address = await publicAddress(url.hostname);
    const response = await requestOnce(url, address, options.headers || {}, maxBytes, options.signal);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location || Array.isArray(location)) throw new PublicHttpError("HTTP_REDIRECT", "Redirect has no usable location");
      url = parsePublicUrl(new URL(location, url).href);
      continue;
    }
    const contentType = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
    if (response.status < 200 || response.status >= 300) {
      throw new PublicHttpError("HTTP_STATUS", `HTTP ${response.status} from ${url.href}`);
    }
    if (!/^(text\/|application\/(json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|javascript))/.test(contentType)) {
      throw new PublicHttpError("UNSUPPORTED_CONTENT_TYPE", `Unsupported content type: ${contentType || "unknown"}`);
    }
    return { url: url.href, status: response.status, contentType, body: response.body.toString("utf-8"), truncated: response.truncated };
  }
  throw new PublicHttpError("TOO_MANY_REDIRECTS", "More than three redirects");
}
