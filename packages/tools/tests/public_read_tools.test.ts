import { describe, expect, it, vi } from "vitest";
import { ToolContext } from "../src/context.js";

const requestPublicText = vi.hoisted(() => vi.fn());
vi.mock("../src/builtin/public_http.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/builtin/public_http.js")>(),
  requestPublicText,
}));

import { handleWebfetch } from "../src/builtin/webfetch.js";
import { handleGithubRepo } from "../src/builtin/github.js";

const ctx = { operationId: "op_1" } as ToolContext;

describe("read-only public tools", () => {
  it("extracts readable text from HTML without scripts", async () => {
    requestPublicText.mockResolvedValueOnce({
      url: "https://example.com/", status: 200, contentType: "text/html",
      body: "<title>Example &amp; test</title><script>hidden()</script><h1>Hello</h1><p>World</p>", truncated: false,
    });
    const result = await handleWebfetch({ url: "https://example.com/" }, ctx);
    expect(result.status).toBe("SUCCESS");
    expect(result.output.title).toBe("Example & test");
    expect(result.output.content).toContain("Hello");
    expect(result.output.content).not.toContain("hidden()");
  });

  it("lists a public repository directory and reads a file through the fixed GitHub API", async () => {
    requestPublicText.mockResolvedValueOnce({
      url: "https://api.github.com/repos/octocat/Hello-World/contents/", status: 200,
      contentType: "application/json", body: JSON.stringify([{ name: "README.md", path: "README.md", type: "file", size: 5, html_url: "https://github.com/octocat/Hello-World/blob/master/README.md" }]), truncated: false,
    });
    const list = await handleGithubRepo({ repository: "octocat/Hello-World" }, ctx);
    expect(list.status).toBe("SUCCESS");
    expect(list.output.entries[0].name).toBe("README.md");
    expect(requestPublicText.mock.calls.at(-1)?.[0]).toBe("https://api.github.com/repos/octocat/Hello-World/contents/");

    requestPublicText.mockResolvedValueOnce({
      url: "https://api.github.com/repos/octocat/Hello-World/contents/README.md", status: 200,
      contentType: "application/json", body: JSON.stringify({ type: "file", path: "README.md", size: 5, sha: "abc", html_url: "https://github.com/octocat/Hello-World/blob/master/README.md", encoding: "base64", content: Buffer.from("Hello").toString("base64") }), truncated: false,
    });
    const file = await handleGithubRepo({ repository: "https://github.com/octocat/Hello-World", path: "README.md" }, ctx);
    expect(file.status).toBe("SUCCESS");
    expect(file.output.content).toBe("Hello");
  });

  it("rejects a repository URL that could redirect the API to another host", async () => {
    const result = await handleGithubRepo({ repository: "https://evil.example/octocat/Hello-World" }, ctx);
    expect(result.error_code).toBe("INVALID_ARGS");
  });
});
