import { Body, Controller, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthService } from './auth.service';

class GuestLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  displayName?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  guest(@Body() dto: GuestLoginDto) {
    return this.auth.guestLogin(dto.deviceId, dto.displayName);
  }
}
