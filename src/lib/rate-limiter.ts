interface HitInfo {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private ipHits = new Map<string, HitInfo>();
  private emailHits = new Map<string, HitInfo>();

  constructor(
    private ipLimit: number = 5,
    private ipWindowMs: number = 15 * 60 * 1000,
    private emailLimit: number = 10,
    private emailWindowMs: number = 60 * 60 * 1000,
  ) {}

  public check(
    ip: string,
    email?: string,
  ): { success: boolean; limitType?: 'ip' | 'email'; resetTime?: number } {
    const now = Date.now();

    // Check IP
    let ipInfo = this.ipHits.get(ip);
    if (!ipInfo || now > ipInfo.resetTime) {
      ipInfo = { count: 0, resetTime: now + this.ipWindowMs };
      this.ipHits.set(ip, ipInfo);
    }

    if (ipInfo.count >= this.ipLimit) {
      return { success: false, limitType: 'ip', resetTime: ipInfo.resetTime };
    }

    // Check Email
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      let emailInfo = this.emailHits.get(normalizedEmail);
      if (!emailInfo || now > emailInfo.resetTime) {
        emailInfo = { count: 0, resetTime: now + this.emailWindowMs };
        this.emailHits.set(normalizedEmail, emailInfo);
      }

      if (emailInfo.count >= this.emailLimit) {
        return { success: false, limitType: 'email', resetTime: emailInfo.resetTime };
      }
    }

    return { success: true };
  }

  public increment(ip: string, email?: string): void {
    const now = Date.now();

    // Increment IP
    let ipInfo = this.ipHits.get(ip);
    if (!ipInfo || now > ipInfo.resetTime) {
      ipInfo = { count: 0, resetTime: now + this.ipWindowMs };
    }
    ipInfo.count++;
    this.ipHits.set(ip, ipInfo);

    // Increment Email
    if (email) {
      const normalizedEmail = email.toLowerCase().trim();
      let emailInfo = this.emailHits.get(normalizedEmail);
      if (!emailInfo || now > emailInfo.resetTime) {
        emailInfo = { count: 0, resetTime: now + this.emailWindowMs };
      }
      emailInfo.count++;
      this.emailHits.set(normalizedEmail, emailInfo);
    }
  }

  public reset(ip: string, email?: string): void {
    this.ipHits.delete(ip);
    if (email) {
      this.emailHits.delete(email.toLowerCase().trim());
    }
  }

  // Helper for tests to clean the memory
  public clear(): void {
    this.ipHits.clear();
    this.emailHits.clear();
  }
}

// Global singleton instance for authentication endpoints
export const authRateLimiter = new RateLimiter(5, 15 * 60 * 1000, 10, 60 * 60 * 1000);
