import { Controller, Get, Headers, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { MailEntity } from '../database/entities';

@Controller('mail')
export class MailController {
  constructor(
    private readonly auth: AuthService,
    @InjectRepository(MailEntity) private readonly mails: Repository<MailEntity>,
  ) {}

  @Get(':playerId')
  list(@Headers('authorization') authorization: string | undefined, @Param('playerId') playerId: string) {
    this.auth.assertPlayerAccess(authorization, playerId);
    return this.mails.find({ where: { playerId }, order: { createdAt: 'DESC' }, take: 50 });
  }
}
