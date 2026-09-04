const insecureValues = new Set([
  'dev-online-token-secret',
  'dev-only-online-token-change-me',
  'dev-admin-token',
  'change-this-long-random-online-auth-token-secret',
  'change-this-long-random-admin-token',
])

const requireSecret = (config: Record<string, unknown>, key: string) => {
  const value = String(config[key] || '').trim()
  if (value.length < 32 || insecureValues.has(value)) {
    throw new Error(`${key} must be a unique secret with at least 32 characters`)
  }
}

export const validateEnvironment = (config: Record<string, unknown>) => {
  if (String(config.NODE_ENV || 'development') !== 'production') return config

  const databaseUrl = String(config.DATABASE_URL || '')
  const redisUrl = String(config.REDIS_URL || '')
  const corsOrigin = String(config.CORS_ORIGIN || '')

  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string in production')
  }
  if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
    throw new Error('REDIS_URL must be configured in production')
  }
  if (!corsOrigin || corsOrigin === '*') {
    throw new Error('CORS_ORIGIN must contain the exact public web origins in production')
  }
  const invalidOrigin = corsOrigin
    .split(',')
    .map((item) => item.trim())
    .find((item) => !item.startsWith('https://'))
  if (invalidOrigin) {
    throw new Error(`CORS_ORIGIN must use HTTPS in production: ${invalidOrigin}`)
  }
  if (String(config.TYPEORM_SYNCHRONIZE || 'false') === 'true') {
    throw new Error('TYPEORM_SYNCHRONIZE cannot be enabled in production; run npm run migration:run instead')
  }

  requireSecret(config, 'AUTH_TOKEN_SECRET')
  requireSecret(config, 'ADMIN_TOKEN')
  requireSecret(config, 'BACKUP_TOKEN')
  return config
}
