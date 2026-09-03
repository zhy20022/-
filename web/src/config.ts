export const getSocketUrl = () => {
  const configured = import.meta.env.VITE_SOCKET_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim()
  }
  return window.location.origin
}

export const isStaticDemoMode = () => import.meta.env.VITE_STATIC_DEMO === 'true'

export const isFormalOnlineMode = () => {
  const configured = import.meta.env.VITE_FORMAL_ONLINE as string | undefined
  if (configured && configured.trim()) {
    return configured.trim() === 'true'
  }
  return !isStaticDemoMode()
}

export const getOnlineApiBase = () => {
  const configured = import.meta.env.VITE_ONLINE_API_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/$/, '')
  }
  if (!isStaticDemoMode() && ['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return 'http://127.0.0.1:4100'
  }
  return window.location.origin
}
