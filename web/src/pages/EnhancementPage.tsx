import { useNavigate } from 'react-router-dom'
import EnhancementPanel from '../components/materials/EnhancementPanel'

export default function EnhancementPage() {
  const navigate = useNavigate()
  return (
    <div className="enhancement-page">
      <div className="enhancement-container">
        <div className="enhancement-header">
          <div className="header-top">
            <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
            <h1>装备强化</h1>
          </div>
        </div>
        <EnhancementPanel />
      </div>
    </div>
  )
}
