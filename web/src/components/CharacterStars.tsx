import { useEffect, useRef, useState } from 'react'
import { createIdempotencyKey, isFormalOnlineMode, loadOnlineProfile, mapOnlineCharacter, onlineApi, getOnlineModeError } from '../services/onlineGameAdapter'
import { useAuthStore } from '../stores/authStore'

export default function CharacterStars({ character, onUpdated }: { character: any; onUpdated: (character: any) => void }) {
  const player = useAuthStore(state => state.player)
  const [preview, setPreview] = useState<any>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const key = useRef<string | null>(null)
  useEffect(() => {
    let alive = true
    if (isFormalOnlineMode()) void loadOnlineProfile(player).then(profile => onlineApi.get(
      `/players/${profile.session.player.id}/characters/${character.character_id}/star-preview`,
    )).then(response => { if (alive) setPreview(response.data) }).catch(error => { if (alive) setMessage(getOnlineModeError(error, '升星信息加载失败')) })
    return () => { alive = false }
  }, [character.character_id, character.star])
  const upgrade = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    key.current ||= createIdempotencyKey('star-up')
    try {
      const profile = await loadOnlineProfile(player)
      const response = await onlineApi.post(`/players/${profile.session.player.id}/characters/${character.character_id}/star-up`, {},
        { headers: { 'Idempotency-Key': key.current } })
      key.current = null
      onUpdated({ ...character, ...mapOnlineCharacter(response.data.character) })
      window.dispatchEvent(new Event('gamer:resources-changed'))
      setMessage('升星成功')
    } catch (error: any) {
      if (error.response && error.response.status < 500) key.current = null
      setMessage(getOnlineModeError(error, '升星失败，请重试'))
    } finally { pending.current = false; setBusy(false) }
  }
  return <section className="character-star-panel" aria-label="角色升星">
    <h3>角色升星</h3>
    {preview ? <>
      <p>{preview.star}星 · 基础属性 {Math.round(preview.multiplier * 100)}%</p>
      <p>角色碎片：{preview.owned}{preview.star < 5 ? ` / ${preview.required}` : ' · 已满星'}</p>
      {preview.star < 5 && <button type="button" disabled={busy || !preview.canUpgrade} onClick={() => void upgrade()}>
        {busy ? '升星中...' : `升至${preview.star + 1}星（${preview.required}碎片）`}</button>}
    </> : <p>{isFormalOnlineMode() ? '正在读取升星信息...' : '升星仅在正式线上模式开放'}</p>}
    {message && <p role="status">{message}</p>}
  </section>
}
