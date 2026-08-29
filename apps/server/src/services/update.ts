import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "../config";
import { AppError } from "../errors";

const execFileAsync = promisify(execFile);
export interface UpdateStatus {
  enabled: boolean;
  state: "idle" | "checking" | "available" | "updating" | "restart-required" | "failed" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  message?: string;
  checkedAt?: string;
  tokenConfigured?: boolean;
  requiresToken?: boolean;
}

export class UpdateService {
  private readonly config: AppConfig;
  private running = false;

  constructor(config: AppConfig) {
    this.config = config;
  }

  private base(state: UpdateStatus["state"] = "idle"): UpdateStatus {
    return { enabled: this.config.updateEnabled === true, state, currentVersion: "unknown", tokenConfigured: Boolean(this.config.updateToken), requiresToken: this.config.authEnabled !== true };
  }

  private async git(args: string[]): Promise<string> {
    const result = await execFileAsync("git", args, { cwd: this.config.projectRoot ?? process.cwd(), timeout: 120_000, windowsHide: true });
    return result.stdout.trim();
  }

  private async currentVersion(): Promise<string> {
    try { return await this.git(["rev-parse", "--short", "HEAD"]); } catch { return "unknown"; }
  }

  async check(): Promise<UpdateStatus> {
    const status = this.base("checking");
    status.currentVersion = await this.currentVersion();
    status.checkedAt = new Date().toISOString();
    if (!this.config.updateEnabled) {
      status.state = "unavailable";
      status.message = "Remote updates are disabled in .env";
      return status;
    }
    try {
      const remote = await this.git(["ls-remote", "origin", this.config.updateBranch]);
      const latest = remote.split(/\s+/)[0] || status.currentVersion;
      status.latestVersion = latest.slice(0, 12);
      status.state = latest && !latest.startsWith(status.currentVersion) ? "available" : "idle";
      status.message = status.state === "available" ? "A new version is available" : "This server is up to date";
    } catch {
      status.state = "failed";
      status.message = "Unable to check the Git remote";
    }
    return status;
  }

  async status(): Promise<UpdateStatus> {
    // A read-only status call is also the server-side polling point used by the UI.
    return this.check();
  }

  authorize(token: string | undefined, authenticated: boolean): void {
    if (this.config.updateEnabled !== true) throw new AppError("UPDATE_DISABLED", "Remote updates are disabled in .env", 403);
    if (this.config.authEnabled === true && authenticated) return;
    if (!this.config.updateToken || !token || token !== this.config.updateToken) throw new AppError("AUTH_REQUIRED", "An update token is required", 401);
  }

  async update(): Promise<UpdateStatus> {
    if (this.running) throw new AppError("UPDATE_IN_PROGRESS", "An update is already running", 409);
    this.running = true;
    const status = this.base("updating");
    try {
      if (!/^[A-Za-z0-9._/-]+$/.test(this.config.updateBranch) || this.config.updateBranch.startsWith("-")) throw new AppError("UPDATE_FAILED", "Invalid update branch configuration", 500);
      await this.git(["pull", "--ff-only", "origin", this.config.updateBranch]);
      const npm = process.platform === "win32" ? "npm.cmd" : "npm";
      const cwd = this.config.projectRoot ?? process.cwd();
      await execFileAsync(npm, ["install"], { cwd, timeout: 30 * 60_000, windowsHide: true });
      await execFileAsync(npm, ["run", "build"], { cwd, timeout: 30 * 60_000, windowsHide: true });
      status.currentVersion = await this.currentVersion();
      status.state = "restart-required";
      status.message = "Update installed; requesting a service restart";
      if (this.config.nodeEnv === "production") {
        // WinSW's onfailure policy restarts the process only after a non-zero exit.
        // Exit 75 after the response has had time to flush so the service manager reloads the build.
        const timer = setTimeout(() => process.exit(75), 1_000);
        timer.unref();
      }
    } catch (error) {
      status.state = "failed";
      status.message = error instanceof AppError ? error.message : "Update failed; the previous build is still running";
      throw new AppError("UPDATE_FAILED", status.message, 502);
    } finally {
      this.running = false;
    }
    return status;
  }
}
