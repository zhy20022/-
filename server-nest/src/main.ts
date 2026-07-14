import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>('CORS_ORIGIN', '*');
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((item) => item.trim()).filter(Boolean),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(config.get('PORT', 4100));
  await app.listen(port, '0.0.0.0');
  console.log(`Gamer Nest API listening on http://127.0.0.1:${port}/api`);
}

void bootstrap();
