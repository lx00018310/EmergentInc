import { request } from "node:http";
import { RootlessSandbox } from "./rootless_sandbox.js";
import { BodyRunner } from "./body_validation.js";

/** The business process never owns a Docker socket or evaluates source. Only a fixed local Unix channel is allowed. */
export class BodySandboxClient implements BodyRunner {
  constructor(private socket: string) {
    if (process.platform !== "linux" || !socket.startsWith("/")) throw new Error("ROOTLESS_LINUX_REQUIRED");
  }
  private call(action: string, body: unknown = {}): Promise<any> {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socket, path: `/${action}`, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
        let text = "";
        res.on("data", chunk => {
          text += chunk;
          if (Buffer.byteLength(text) > 65536) req.destroy(new Error("SANDBOX_OUTPUT_LIMIT"));
        });
        res.on("end", () => { try {
          const value = JSON.parse(text);
          if (res.statusCode !== 200) reject(new Error(value.detail ?? "BODY_SANDBOX_UNAVAILABLE"));
          else resolve(value.result);
        } catch { reject(new Error("BODY_SANDBOX_RESPONSE_INVALID")); } });
        res.on("error", reject);
      });
      const timer = setTimeout(() => req.destroy(new Error("SANDBOX_COMMAND_TIMEOUT")), 30000);
      req.on("close", () => clearTimeout(timer)); req.on("error", reject); req.end(data);
    });
  }
  probe(): ReturnType<RootlessSandbox["probe"]> { return this.call("probe"); }
  runBody(source: string, input: unknown): Promise<unknown> { return this.call("run", { source, input }); }
  recoverInterrupted(_options: { exclusiveSupervisorLockHeld: true }): ReturnType<RootlessSandbox["recoverInterrupted"]> {
    // Recovery belongs to worker startup under its own lock; the app can only verify readiness.
    return this.call("ready");
  }
}
