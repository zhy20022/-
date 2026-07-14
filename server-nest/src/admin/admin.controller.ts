import { Body, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { Response } from 'express';
import { AdminService } from './admin.service';

class BanUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

class SendMailDto {
  @IsString()
  playerId: string;

  @IsString()
  @MaxLength(80)
  title: string;

  @IsString()
  @MaxLength(2000)
  body: string;

  @IsArray()
  rewards: Array<Record<string, unknown>>;
}

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  html(@Res() response: Response) {
    response.type('html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Gamer Admin</title>
  <style>
    body{font-family:Arial,sans-serif;margin:0;background:#eef2f5;color:#172033}
    main{max-width:980px;margin:40px auto;background:#fff;border:1px solid #dbe3ea;border-radius:8px;padding:24px}
    h1{margin-top:0} code{background:#eef2f5;padding:2px 5px;border-radius:4px}
    section{border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px}
    li{margin:8px 0}
  </style>
</head>
<body>
  <main>
    <h1>Gamer Admin</h1>
    <p>Simple operation backend for the NestJS online-game server.</p>
    <section>
      <h2>API</h2>
      <ul>
        <li><code>GET /health</code></li>
        <li><code>POST /auth/guest</code></li>
        <li><code>GET /players/:playerId/profile</code></li>
        <li><code>GET /configs</code> and <code>GET /configs/skills</code></li>
        <li><code>GET /inventory/:playerId</code>, <code>POST /inventory/:playerId/grant</code></li>
        <li><code>GET /gacha/pools</code>, <code>POST /gacha/:playerId/draw</code></li>
        <li><code>POST /battle-settlement</code>, <code>GET /battle-settlement/:playerId/progress</code></li>
        <li><code>GET /ranking/:rankingKey</code>, <code>POST /ranking/:rankingKey/score</code></li>
        <li><code>POST /friends-assist/:playerId/request</code>, <code>POST /friends-assist/:playerId/accept</code>, <code>GET /friends-assist/:playerId</code></li>
        <li><code>GET /friends-assist/:playerId/assist-roster</code>, <code>POST /friends-assist/:playerId/assist</code></li>
        <li><code>GET /guild</code>, <code>POST /guild</code>, <code>POST /guild/:guildId/join</code>, <code>POST /guild/contribute</code></li>
        <li><code>GET /admin/dashboard</code></li>
        <li><code>POST /admin/mail</code></li>
        <li><code>POST /admin/users/:userId/ban</code></li>
      </ul>
      <p>Admin read and mutation APIs expect <code>x-admin-token</code>.</p>
    </section>
  </main>
</body>
</html>`);
  }

  @Get('dashboard')
  dashboard(@Headers('x-admin-token') token: string) {
    this.assertAdminToken(token);
    return this.admin.dashboard();
  }

  @Get('players')
  players(@Headers('x-admin-token') token: string, @Query('q') query?: string) {
    this.assertAdminToken(token);
    return this.admin.listPlayers(query);
  }

  @Get('operations')
  operations(@Headers('x-admin-token') token: string) {
    this.assertAdminToken(token);
    return this.admin.operationsDashboard();
  }

  @Get('players/:playerId/operations')
  playerOperations(@Headers('x-admin-token') token: string, @Param('playerId') playerId: string) {
    this.assertAdminToken(token);
    return this.admin.playerOperations(playerId);
  }

  @Get('logs')
  logs(@Headers('x-admin-token') token: string) {
    this.assertAdminToken(token);
    return this.admin.listLogs();
  }

  @Post('users/:userId/ban')
  ban(@Headers('x-admin-token') token: string, @Param('userId') userId: string, @Body() dto: BanUserDto) {
    this.assertAdminToken(token);
    return this.admin.banUser(userId, 'admin', dto.reason);
  }

  @Post('mail')
  mail(@Headers('x-admin-token') token: string, @Body() dto: SendMailDto) {
    this.assertAdminToken(token);
    return this.admin.sendMail('admin', dto.playerId, dto.title, dto.body, dto.rewards);
  }

  private assertAdminToken(token?: string) {
    const expected = this.config.get<string>('ADMIN_TOKEN', 'dev-admin-token');
    if (token !== expected) {
      throw new UnauthorizedException('invalid admin token');
    }
  }
}
