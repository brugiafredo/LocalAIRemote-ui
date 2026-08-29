import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config";
import { AppError } from "../errors";

export interface AuthUser {
  id: string;
  displayName: string;
}

const cookieName = "local_ai_session";
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export class AuthService {
  private readonly sessions = new Map<string, { user: AuthUser; expiresAt: number }>();
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.authEnabled === true;
  }

  userFor(request: FastifyRequest): AuthUser | null {
    if (!this.enabled) {
      return { id: "local-user", displayName: "Local user" };
    }
    const cookieHeader = request.headers.cookie ?? "";
    const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session.user;
  }

  requireUser(request: FastifyRequest): AuthUser {
    const user = this.userFor(request);
    if (!user) throw new AppError("AUTH_REQUIRED", "Sign in to use this feature", 401);
    return user;
  }

  login(password: string, reply: FastifyReply): AuthUser {
    if (!this.enabled) {
      return { id: "local-user", displayName: "Local user" };
    }
    const configured = this.config.authPassword;
    const supplied = Buffer.from(password);
    const expected = Buffer.from(configured ?? "");
    const valid = Boolean(configured) && supplied.length === expected.length && timingSafeEqual(supplied, expected);
    if (!valid) throw new AppError("INVALID_CREDENTIALS", "Invalid password", 401);
    const token = randomBytes(32).toString("hex");
    const user = { id: "local-user", displayName: "Local user" };
    this.sessions.set(token, { user, expiresAt: Date.now() + sessionLifetimeMs });
    reply.header("set-cookie", `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`);
    return user;
  }

  logout(request: FastifyRequest, reply: FastifyReply): void {
    const cookieHeader = request.headers.cookie ?? "";
    const token = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (token) this.sessions.delete(token);
    reply.header("set-cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  status(request: FastifyRequest): { enabled: boolean; authenticated: boolean; user?: AuthUser } {
    const user = this.userFor(request);
    return { enabled: this.enabled, authenticated: Boolean(user), ...(user ? { user } : {}) };
  }
}
