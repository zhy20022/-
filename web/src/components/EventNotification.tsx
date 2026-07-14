/**
 * 活动切换通知组件（顶部横幅）
 */

import React, { useEffect, useState } from 'react'
import './EventNotification.css'

interface EventNotificationProps {
  eventName: string
  onClose?: () => void
  duration?: number // 显示时长（毫秒），默认3000ms
}

const EventNotification: React.FC<EventNotificationProps> = ({
  eventName,
  onClose,
  duration = 3000,
}) => {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => {
        onClose?.()
      }, 300) // 等待动画完成
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  if (!visible) {
    return null
  }

  return (
    <div className="event-notification">
      <div className="event-notification-content">
        <div className="event-notification-icon">⚡</div>
        <div className="event-notification-text">
          <div className="event-notification-title">新的兽潮已经开启</div>
          <div className="event-notification-message">
            {eventName}来袭，参与抵御！
          </div>
        </div>
        <button
          className="event-notification-close"
          onClick={() => {
            setVisible(false)
            setTimeout(() => {
              onClose?.()
            }, 300)
          }}
        >
          ×
        </button>
      </div>
    </div>
  )
}

export default EventNotification


