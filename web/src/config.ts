const getRuntimeConfig = () => window.__GAMER_RUNTIME_CONFIG__ || {}

export const getSocketUrl = () => {
  const runtime = getRuntimeConfig().socketUrl
  if (runtime && runtime.trim()) return runtime.trim().replace(/\/$/, '')
  const configured = import.meta.env.VITE_SOCKET_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim()
  }
  return window.location.origin
}

export const isStaticDemoMode = () => {
  const runtime = getRuntimeConfig().staticDemo
  return typeof runtime === 'boolean' ? runtime : import.meta.env.VITE_STATIC_DEMO === 'true'
}

export const isFormalOnlineMode = () => {
  const runtime = getRuntimeConfig().formalOnline
  if (typeof runtime === 'boolean') return runtime
  const configured = import.meta.env.VITE_FORMAL_ONLINE as string | undefined
  if (configured && configured.trim()) {
    return configured.trim() === 'true'
  }
  return !isStaticDemoMode()
}

export const getOnlineApiBase = () => {
  const runtime = getRuntimeConfig().apiBase
  if (runtime && runtime.trim()) return runtime.trim().replace(/\/$/, '')
  const configured = import.meta.env.VITE_ONLINE_API_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/$/, '')
  }
  if (!isStaticDemoMode() && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'http://127.0.0.1:4100'
  }
  return window.location.origin
}
