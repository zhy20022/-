import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response, json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const config = app.get(ConfigService);
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  express.set('trust proxy', Number(config.get('TRUST_PROXY_HOPS', 1)));

  app.use(json({ limit: config.get<string>('REQUEST_BODY_LIMIT', '256kb') }));
  app.use(urlencoded({ extended: false, limit: config.get<string>('REQUEST_BODY_LIMIT', '256kb') }));

  const rateWindowMs = Number(config.get('RATE_LIMIT_WINDOW_MS', 60000));
  const rateLimit = Number(config.get('RATE_LIMIT_MAX', 180));
  const requestBuckets = new Map<string, { count: number; resetAt: number }>();
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');

    if (request.path.startsWith('/api/health')) return next();
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const current = requestBuckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + rateWindowMs }
      : current;
    bucket.count += 1;
    requestBuckets.set(key, bucket);
    response.setHeader('RateLimit-Limit', String(rateLimit));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, rateLimit - bucket.count)));
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > rateLimit) {
      response.status(429).json({ statusCode: 429, message: 'too many requests, please retry later' });
      return;
    }
    if (requestBuckets.size > 10000) {
      for (const [bucketKey, value] of requestBuckets) {
        if (value.resetAt <= now) requestBuckets.delete(bucketKey);
      }
    }
    next();
  });

  const corsOrigin = config.get<string>('CORS_ORIGIN', '*');
  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((item) => item.trim()).filter(Boolean),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(config.get('PORT', 4100));
  await app.listen(port, '0.0.0.0');
  console.log(`Gamer Nest API listening on port ${port}`);
}

void bootstrap();
