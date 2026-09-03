import { Body, Controller, Post } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

class PasswordLoginDto {
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(/^[A-Za-z0-9_\u4e00-\u9fa5]+$/)
  username: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}

class RegisterDto extends PasswordLoginDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  guest(@Body() dto: GuestLoginDto) {
    return this.auth.guestLogin(dto.deviceId, dto.displayName);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.username, dto.password, dto.email);
  }

  @Post('login')
  login(@Body() dto: PasswordLoginDto) {
    return this.auth.login(dto.username, dto.password);
  }
}
