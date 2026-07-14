export const getSocketUrl = () => {
  const configured = import.meta.env.VITE_SOCKET_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim()
  }
  return window.location.origin
}

export const getOnlineApiBase = () => {
  const configured = import.meta.env.VITE_ONLINE_API_URL as string | undefined
  if (configured && configured.trim()) {
    return configured.trim().replace(/\/$/, '')
  }
  return window.location.origin
}
