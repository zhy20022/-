/**
 * 屏幕方向检测和管理Hook
 * 参考：NEOWIZ 棕色尘埃2 的横竖屏切换体验
 */

import { useState, useEffect, useCallback } from 'react'

export type Orientation = 'portrait' | 'landscape' | 'auto'

interface LockableScreenOrientation extends ScreenOrientation {
  lock?: (orientation: 'portrait' | 'landscape') => Promise<void>
}

interface OrientationState {
  orientation: Orientation
  isPortrait: boolean
  isLandscape: boolean
  screenWidth: number
  screenHeight: number
  isMobile: boolean
  isDesktop: boolean
}

/**
 * 检测是否为移动设备
 */
const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || window.innerWidth <= 768
}

/**
 * 检测当前屏幕方向
 */
const detectOrientation = (): 'portrait' | 'landscape' => {
  if (typeof window === 'undefined') return 'landscape'
  
  // 优先使用Screen Orientation API
  if (window.screen?.orientation) {
    const angle = window.screen.orientation.angle
    return angle === 0 || angle === 180 ? 'portrait' : 'landscape'
  }
  
  // 降级方案：使用窗口尺寸判断
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
}

/**
 * 屏幕方向管理Hook
 */
export const useOrientation = () => {
  const [state, setState] = useState<OrientationState>(() => {
    const currentOrientation = detectOrientation()
    const mobile = isMobileDevice()
    
    return {
      orientation: 'auto' as Orientation,
      isPortrait: currentOrientation === 'portrait',
      isLandscape: currentOrientation === 'landscape',
      screenWidth: typeof window !== 'undefined' ? window.innerWidth : 1920,
      screenHeight: typeof window !== 'undefined' ? window.innerHeight : 1080,
      isMobile: mobile,
      isDesktop: !mobile,
    }
  })

  // 更新屏幕状态
  const updateState = useCallback(() => {
    const currentOrientation = detectOrientation()
    const mobile = isMobileDevice()
    
    setState(prev => ({
      ...prev,
      isPortrait: currentOrientation === 'portrait',
      isLandscape: currentOrientation === 'landscape',
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      isMobile: mobile,
      isDesktop: !mobile,
    }))
  }, [])

  // 设置方向偏好
  const setOrientation = useCallback((orientation: Orientation) => {
    setState(prev => ({ ...prev, orientation }))
    
    // 保存到localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferred-orientation', orientation)
    }

    // 如果是移动设备，尝试锁定屏幕方向
    if (isMobileDevice() && typeof window !== 'undefined') {
      try {
        const screenOrientation = window.screen?.orientation as LockableScreenOrientation | undefined
        if (screenOrientation?.lock) {
          if (orientation === 'portrait') {
            screenOrientation.lock('portrait').catch(() => {
              // 锁定失败时忽略错误（某些浏览器不支持）
            })
          } else if (orientation === 'landscape') {
            screenOrientation.lock('landscape').catch(() => {
              // 锁定失败时忽略错误
            })
          } else {
            // auto模式：解锁方向
            screenOrientation.unlock()
          }
        }
      } catch (error) {
        // 某些浏览器不支持方向锁定，忽略错误
        console.debug('Screen orientation lock not supported:', error)
      }
    }
  }, [])

  // 切换方向
  const toggleOrientation = useCallback(() => {
    setState(prev => {
      const newOrientation = prev.isPortrait ? 'landscape' : 'portrait'
      setOrientation(newOrientation)
      return { ...prev, orientation: newOrientation }
    })
  }, [setOrientation])

  // 监听屏幕方向变化
  useEffect(() => {
    // 从localStorage恢复偏好设置
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('preferred-orientation') as Orientation | null
      if (saved && ['portrait', 'landscape', 'auto'].includes(saved)) {
        setState(prev => ({ ...prev, orientation: saved }))
      }
    }

    // 监听窗口大小变化
    const handleResize = () => {
      updateState()
    }

    // 监听屏幕方向变化（使用Screen Orientation API）
    const handleOrientationChange = () => {
      updateState()
    }

    // 监听媒体查询变化（降级方案）
    const portraitMedia = window.matchMedia('(orientation: portrait)')
    const landscapeMedia = window.matchMedia('(orientation: landscape)')
    
    const handleMediaChange = () => {
      updateState()
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleOrientationChange)
    
    // 使用Screen Orientation API（如果支持）
    if (window.screen?.orientation) {
      window.screen.orientation.addEventListener('change', handleOrientationChange)
    }
    
    portraitMedia.addEventListener('change', handleMediaChange)
    landscapeMedia.addEventListener('change', handleMediaChange)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleOrientationChange)
      
      if (window.screen?.orientation) {
        window.screen.orientation.removeEventListener('change', handleOrientationChange)
      }
      
      portraitMedia.removeEventListener('change', handleMediaChange)
      landscapeMedia.removeEventListener('change', handleMediaChange)
    }
  }, [updateState])

  return {
    ...state,
    setOrientation,
    toggleOrientation,
  }
}


