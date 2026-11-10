import { useNavigate } from 'react-router-dom'
import CraftingPanel from '../components/materials/CraftingPanel'

export default function CraftingPage() {
  const navigate = useNavigate()
  return (
    <div className="crafting-page">
      <div className="page-container">
        <div className="header-top">
          <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          <h1>制作系统</h1>
        </div>
        <CraftingPanel />
      </div>
    </div>
  )
}
