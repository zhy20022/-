import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class ActiveAccountGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    // Gateway middleware and recovery handlers revalidate the same AuthService.
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers.authorization) {
      await this.auth.verifyActiveAuthorization(request.headers.authorization);
    }
    return true;
  }
}
