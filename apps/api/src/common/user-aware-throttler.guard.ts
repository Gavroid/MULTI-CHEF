// T39-A/T62-B (audit rounds 39/62): per-user tracker вместо per-IP.
// Авторизованный запрос трекается по sha256(mc_session) — несколько
// устройств одного пользователя делят честную квоту, а пользователи
// за NAT не отнимают её друг у друга. Анонимные запросы — по IP.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ThrottlerGuard } from '@nestjs/throttler';

type ReqLike = {
  cookies?: Record<string, string | undefined>;
  ip?: string;
  ips?: string[];
};

@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as ReqLike;
    const token = r.cookies?.['mc_session'];
    if (token) {
      return `u:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
    }
    const ip = r.ips?.length ? r.ips[r.ips.length - 1] : r.ip;
    return `ip:${ip ?? 'unknown'}`;
  }
}
