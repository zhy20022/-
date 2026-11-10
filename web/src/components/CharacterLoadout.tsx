import { EQUIPMENT_SLOTS, equipmentPieces } from '../services/characterEquipment'
import { Shield, Swords } from 'lucide-react'

export default function CharacterLoadout({ character }: { character: any }) {
  const pieces = equipmentPieces(character.equipment)
  const portrait = character.equipment?.illustrations?.selected_path || character.portrait
  return <div className="character-loadout">
    <div className="loadout-portrait" aria-label={`${character.name}头像`}>
      {portrait ? <img src={portrait} alt={character.name} /> : <span>{character.name.slice(0, 1)}</span>}
    </div>
    <div className={`loadout-exclusive ${character.equipment?.weapon ? 'equipped' : ''}`}
      title={character.equipment?.weapon?.name || '未装备专属道具'} aria-label="专属道具">
      <Swords size={20} /><small>专属</small>
    </div>
    <div className="loadout-slots">
      {EQUIPMENT_SLOTS.map(([key, label]) => <div key={key} className={`loadout-slot ${pieces[key] ? 'equipped' : ''}`}
        title={`${label}：${(pieces[key] as any)?.name || '未装备'}`} aria-label={`${label}槽位`}><Shield size={12} /><small>{label === '戒指' ? '戒' : label === '项链' ? '链' : label}</small></div>)}
    </div>
  </div>
}
