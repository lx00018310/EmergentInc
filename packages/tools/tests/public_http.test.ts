import { describe, expect, it } from "vitest";
import { requestPublicText } from "../src/builtin/public_http.js";

describe("public HTTP boundary", () => {
  it("blocks local addresses before opening a connection", async () => {
    await expect(requestPublicText("http://127.0.0.1:8765/secret")).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(requestPublicText("http://[::1]/secret")).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(requestPublicText("http://10.0.0.1/secret")).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
    await expect(requestPublicText("http://198.18.0.1/secret")).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  it("rejects non-HTTP URLs and credentials", async () => {
    await expect(requestPublicText("file:///etc/passwd")).rejects.toMatchObject({ code: "INVALID_URL" });
    await expect(requestPublicText("https://user:pass@example.com/")).rejects.toMatchObject({ code: "INVALID_URL" });
  });
});
