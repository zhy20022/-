import { useNavigate } from 'react-router-dom'
import InventoryPanel from '../components/materials/InventoryPanel'

export default function InventoryPage() {
  const navigate = useNavigate()
  return (
    <div className="inventory-page">
      <div className="page-container">
        <div className="header-top">
          <button onClick={() => navigate('/')} className="back-btn">返回主界面</button>
          <h1>背包</h1>
        </div>
        <InventoryPanel />
      </div>
    </div>
  )
}
