import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { PlayerEntity, UserEntity } from '../database/entities';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(PlayerEntity) private readonly players: Repository<PlayerEntity>,
  ) {}

  async guestLogin(deviceId?: string, displayName?: string) {
    if (this.config.get<string>('NODE_ENV') === 'production' && this.config.get<string>('ALLOW_GUEST_LOGIN') !== 'true') {
      throw new ForbiddenException('guest login is disabled');
    }
    const accountId = `guest:${deviceId || randomUUID()}`;
    let user = await this.users.findOne({ where: { accountId } });
    if (!user) {
      user = this.users.create({ accountId, provider: 'guest', metadata: { deviceId: deviceId || null } });
      await this.users.save(user);
    }

    let player = await this.players.findOne({ where: { userId: user.id } });
    if (!player) {
      player = this.players.create({
        userId: user.id,
        displayName: displayName || `Guest_${user.id.slice(0, 8)}`,
        gold: 100000,
      });
      await this.players.save(player);
    }

    return this.buildSession(user, player);
  }

  async register(username: string, password: string, email?: string) {
    const normalized = username.trim().toLowerCase();
    const accountId = `password:${normalized}`;
    if (await this.users.findOne({ where: { accountId } })) {
      throw new ConflictException('username already exists');
    }
    if (await this.players.findOne({ where: { displayName: username.trim() } })) {
      throw new ConflictException('display name already exists');
    }

    const user = this.users.create({
      accountId,
      provider: 'password',
      passwordHash: await hash(password, 12),
      metadata: email ? { email: email.trim().toLowerCase() } : {},
    });
    await this.users.save(user);
    try {
      const player = await this.players.save(this.players.create({
        userId: user.id,
        displayName: username.trim(),
        gold: 100000,
      }));
      return this.buildSession(user, player);
    } catch (error) {
      await this.users.delete(user.id);
      throw error;
    }
  }

  async login(username: string, password: string) {
    const accountId = `password:${username.trim().toLowerCase()}`;
    const user = await this.users.findOne({ where: { accountId } });
    if (!user?.passwordHash || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('invalid username or password');
    }
    if (user.status !== 'active') throw new ForbiddenException('account is unavailable');
    const player = await this.players.findOne({ where: { userId: user.id } });
    if (!player) throw new UnauthorizedException('player profile is missing');
    return this.buildSession(user, player);
  }

  assertPlayerAccess(authorization: string | undefined, playerId: string) {
    const session = this.verifyAuthorization(authorization);
    if (session.playerId !== playerId) {
      throw new UnauthorizedException('token player does not match requested player');
    }
    return session;
  }

  verifyAuthorization(authorization?: string) {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : authorization;
    if (!token) throw new UnauthorizedException('missing authorization token');
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'online') {
      throw new UnauthorizedException('invalid authorization token');
    }
    const [, payload, signature] = parts;
    const expected = Buffer.from(this.signPayload(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('invalid authorization signature');
    }
    try {
      const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
        userId?: string;
        playerId?: string;
        exp?: number;
      };
      if (!parsed.userId || !parsed.playerId || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('authorization token expired');
      }
      return { userId: parsed.userId, playerId: parsed.playerId };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('invalid authorization payload');
    }
  }

  private signToken(userId: string, playerId: string) {
    const payload = Buffer.from(JSON.stringify({
      userId,
      playerId,
      exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    })).toString('base64url');
    return `online.${payload}.${this.signPayload(payload)}`;
  }

  private buildSession(user: UserEntity, player: PlayerEntity) {
    return {
      accessToken: this.signToken(user.id, player.id),
      user: { id: user.id, provider: user.provider, status: user.status },
      player,
    };
  }

  private signPayload(payload: string) {
    const secret = this.config.get<string>('AUTH_TOKEN_SECRET', 'dev-online-token-secret');
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
