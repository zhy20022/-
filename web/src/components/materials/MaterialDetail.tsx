import { LegacyInventoryItem } from '../../services/onlineInventoryAdapter'
import { materialUsage, getMaterialKind } from '../../services/materialCatalog'
import { isFormalOnlineMode, isStaticDemoMode } from '../../config'

export default function MaterialDetail({ item, onClose, onNavigate }: {
  item: LegacyInventoryItem
  onClose: () => void
  onNavigate: (path: string) => void
}) {
  const kind = getMaterialKind(item)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="modal-content material-detail" role="dialog" aria-modal="true" aria-label={item.item_name} onClick={(event) => event.stopPropagation()}>
        <header><h2>{item.item_name}</h2><button type="button" aria-label="关闭材料详情" onClick={onClose}>×</button></header>
        <dl>
          <dt>数量</dt><dd>{item.count}</dd>
          <dt>属性</dt><dd>{item.attribute_type || item.item_data?.attributeType || item.item_data?.attribute_type || '通用 / 未标注'}</dd>
          <dt>用途</dt><dd>{materialUsage(item, !isFormalOnlineMode() && !isStaticDemoMode())}</dd>
          <dt>状态</dt><dd>{item.is_locked ? '已锁定' : '未锁定'} · {item.is_equipped ? '已装备' : '未装备'}</dd>
          <dt>来源</dt><dd>{item.item_data?.source || '未标注'}</dd>
        </dl>
        <footer>
          {kind === 'experience' && <button onClick={() => onNavigate('/materials?tab=avatars')}>选择角色</button>}
          {['weapon', 'equipment'].includes(item.item_type) && <button onClick={() => onNavigate(`/materials?tab=enhancement&itemId=${encodeURIComponent(item.item_id)}`)}>强化与突破</button>}
          {['exclusive', 'equipment', 'shared'].includes(kind) && <button onClick={() => onNavigate('/materials?tab=crafting')}>制作</button>}
        </footer>
      </section>
    </div>
  )
}
