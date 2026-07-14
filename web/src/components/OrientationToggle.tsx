/**
 * 横竖屏切换按钮组件
 * 参考：NEOWIZ 棕色尘埃2 的切换体验
 */

import React from 'react'
import { useOrientation } from '../hooks/useOrientation'
import './OrientationToggle.css'

interface OrientationToggleProps {
  className?: string
  showLabel?: boolean
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
}

const OrientationToggle: React.FC<OrientationToggleProps> = ({
  className = '',
  showLabel = true,
  position = 'top-right',
}) => {
  const { isPortrait, toggleOrientation, isMobile } = useOrientation()

  // 在桌面端，这个按钮主要用于预览效果，不强制锁定方向
  const handleToggle = () => {
    toggleOrientation()
    
    // 添加触觉反馈（如果支持）
    if (navigator.vibrate && isMobile) {
      navigator.vibrate(10)
    }
  }

  return (
    <button
      className={`orientation-toggle ${className} ${position} ${isPortrait ? 'portrait' : 'landscape'}`}
      onClick={handleToggle}
      aria-label={isPortrait ? '切换到横屏' : '切换到竖屏'}
      title={isPortrait ? '切换到横屏' : '切换到竖屏'}
    >
      <div className="orientation-icon">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {isPortrait ? (
            // 横屏图标
            <path d="M8 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
          ) : (
            // 竖屏图标
            <rect x="4" y="4" width="16" height="16" rx="2" />
          )}
        </svg>
      </div>
      {showLabel && (
        <span className="orientation-label">
          {isPortrait ? '横屏' : '竖屏'}
        </span>
      )}
    </button>
  )
}

export default OrientationToggle


