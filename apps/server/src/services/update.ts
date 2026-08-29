import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { AppConfig } from "../config";
import { AppError } from "../errors";

const execFileAsync = promisify(execFile);
export interface UpdateStatus {
  enabled: boolean;
  state: "idle" | "checking" | "available" | "updating" | "restart-required" | "failed" | "unavailable";
  currentVersion: string;
  latestVersion?: string;
  buildVersion?: string;
  message?: string;
  checkedAt?: string;
  tokenConfigured?: boolean;
  requiresToken?: boolean;
}

export interface ServerVersion {
  commit: string;
  shortCommit: string;
  buildCommit: string;
  buildShortCommit: string;
  runningCommit: string;
  runningShortCommit: string;
  bootId: string;
  branch: string;
  startedAt: string;
}

export class UpdateService {
  private readonly config: AppConfig;
  private running = false;
  private readonly startedAt = new Date().toISOString();
  private readonly buildMetadataPath: string;
  private readonly runningCommit: string;
  private readonly bootId = randomUUID();

  constructor(config: AppConfig) {
    this.config = config;
    this.buildMetadataPath = path.join(config.projectRoot, "apps", "web", "dist", "build-meta.json");
    try {
      this.runningCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: config.projectRoot, timeout: 10_000, windowsHide: true, encoding: "utf8" }).trim() || "unknown";
    } catch {
      this.runningCommit = "unknown";
    }
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

  private async currentBuildVersion(): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.buildMetadataPath, "utf8"));
      if (typeof parsed === "object" && parsed !== null && "commit" in parsed && typeof parsed.commit === "string" && parsed.commit.length > 0) {
        return parsed.commit;
      }
    } catch {
      // A missing marker means the compiled web bundle predates build identity support.
    }
    return "unknown";
  }

  private commitsMatch(left: string, right: string): boolean {
    return left !== "unknown" && right !== "unknown" && (left === right || left.startsWith(right) || right.startsWith(left));
  }

  async version(): Promise<ServerVersion> {
    const [commit, branch, buildCommit] = await Promise.all([
      this.git(["rev-parse", "HEAD"]).catch(() => "unknown"),
      this.git(["branch", "--show-current"]).catch(() => "unknown"),
      this.currentBuildVersion(),
    ]);
    return {
      commit,
      shortCommit: commit === "unknown" ? "unknown" : commit.slice(0, 7),
      buildCommit,
      buildShortCommit: buildCommit === "unknown" ? "unknown" : buildCommit.slice(0, 7),
      runningCommit: this.runningCommit,
      runningShortCommit: this.runningCommit === "unknown" ? "unknown" : this.runningCommit.slice(0, 7),
      bootId: this.bootId,
      branch: branch || "unknown",
      startedAt: this.startedAt,
    };
  }

  private requestRestart(): void {
    if (this.config.nodeEnv !== "production") return;
    // WinSW's onfailure policy restarts the process only after a non-zero exit.
    // Delay long enough for the HTTP response to reach the client first.
    const timer = setTimeout(() => process.exit(75), 1_000);
    timer.unref();
  }

  async check(): Promise<UpdateStatus> {
    const status = this.base("checking");
    status.currentVersion = await this.currentVersion();
    status.buildVersion = await this.currentBuildVersion();
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
      const sourceMatchesRemote = this.commitsMatch(latest, status.currentVersion);
      const buildMatchesSource = this.commitsMatch(status.currentVersion, status.buildVersion || "unknown");
      status.state = !sourceMatchesRemote || !buildMatchesSource ? "available" : "idle";
      status.message = !buildMatchesSource
        ? "The server source and compiled UI are out of sync; rebuild required"
        : status.state === "available" ? "A new version is available" : "This server is up to date";
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
      status.buildVersion = await this.currentBuildVersion();
      if (!this.commitsMatch(status.currentVersion, status.buildVersion)) {
        throw new AppError("UPDATE_FAILED", "The build completed but its UI bundle does not match the current source commit", 502);
      }
      status.state = "restart-required";
      status.message = "Update installed; requesting a service restart";
      this.requestRestart();
    } catch (error) {
      status.state = "failed";
      status.message = error instanceof AppError ? error.message : "Update failed; the previous build is still running";
      throw new AppError("UPDATE_FAILED", status.message, 502);
    } finally {
      this.running = false;
    }
    return status;
  }

  async restart(): Promise<UpdateStatus> {
    if (this.running) throw new AppError("UPDATE_IN_PROGRESS", "An update or restart is already running", 409);
    this.running = true;
    const status = this.base("restart-required");
    try {
      status.currentVersion = await this.currentVersion();
      status.message = this.config.nodeEnv === "production"
        ? "Restart requested; waiting for the service to come back online"
        : "Restart requested (development/test mode does not terminate the process)";
      this.requestRestart();
      return status;
    } finally {
      this.running = false;
    }
  }
}
