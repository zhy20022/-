import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'
import { io, Socket } from 'socket.io-client'
import { getSocketUrl } from '../config'
import { useAuthStore } from '../stores/authStore'
import './MultiplayerRoomPage.css'

interface Dungeon {
  dungeon_id: string
  name: string
  dungeon_type: string
  attribute_type: string
  difficulty?: string
  difficulty_key?: string
  is_unlocked: boolean
  recommendation?: {
    recommended_level: number
    summary: string
  }
}

interface Character {
  character_id: string
  name: string
  level: number
  attribute_type: string
  profession_type: string
}

type TeamRole = 'tank' | 'healer' | 'support' | 'dps'

interface RoomMember {
  player_id: string
  username: string
  character_ids: string[]
  selected_characters?: Partial<Character>[]
  is_ready: boolean
  connection_status?: string
  reconnect_remaining_seconds?: number | null
}

interface MultiplayerRoom {
  room_id: string
  dungeon_id: string
  dungeon_type: string
  leader_id: string
  capacity: number
  max_characters_per_member: number
  status: string
  battle_id?: string | null
  members: RoomMember[]
}

interface RoomChatMessage {
  message_id: string
  room_id: string
  player_id: string
  username: string
  message: string
  created_at: string
}

interface RoomInvitation {
  invitation_id: string
  room_id: string
  inviter_id: string
  invitee_id: string
  invitee_username: string
  inviter_username?: string
  status: string
  is_available?: boolean
  dungeon?: {
    dungeon_id: string
    name: string
    dungeon_type: string
    attribute_type: string
    difficulty: string
  } | null
  room?: MultiplayerRoom | null
  created_at: string
}

const normalizeDungeonType = (type: string) => {
  if (type === 'SQUAD' || type.includes('5')) return 'SQUAD'
  if (type === 'TEAM' || type.includes('20')) return 'TEAM'
  if (type === 'SERVER_BOSS' || type.toLowerCase().includes('boss')) return 'SERVER_BOSS'
  return 'SINGLE'
}

const TEAM_ROLE_IDEAL: Record<TeamRole, { min: number; max: number; label: string }> = {
  tank: { min: 3, max: 4, label: 'Tank' },
  healer: { min: 3, max: 5, label: 'Healer' },
  support: { min: 2, max: 4, label: 'Support' },
  dps: { min: 9, max: 12, label: 'DPS' }
}

const classifyTeamRole = (professionType?: string): TeamRole => {
  const text = String(professionType || '').toLowerCase()
  if (text.includes('support') || text.includes('aux') || text.includes('\u8f85\u52a9')) return 'support'
  if (text.includes('healer') || text.includes('heal') || text.includes('\u6cbb\u7597')) return 'healer'
  if (text.includes('tank') || text.includes('\u5766\u514b')) return 'tank'
  if (text.includes('dps') || text.includes('\u8f93\u51fa')) return 'dps'
  return 'dps'
}

const getTeamRewardTier = (score: number) => {
  if (score >= 90) return 'S'
  if (score >= 78) return 'A'
  if (score >= 62) return 'B'
  return 'C'
}

const MultiplayerRoomPage: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { player } = useAuthStore()
  const initialDungeonId = (location.state as { dungeon_id?: string } | null)?.dungeon_id
  const [dungeons, setDungeons] = useState<Dungeon[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [rooms, setRooms] = useState<MultiplayerRoom[]>([])
  const [selectedDungeonId, setSelectedDungeonId] = useState(initialDungeonId || '')
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([])
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(() => window.localStorage.getItem('gamer_current_room_id'))
  const [message, setMessage] = useState('')
  const [chatMessages, setChatMessages] = useState<RoomChatMessage[]>([])
  const [chatDraft, setChatDraft] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [invitations, setInvitations] = useState<RoomInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const socketRef = useRef<Socket | null>(null)
  const watchedRoomRef = useRef<string | null>(null)

  const multiplayerDungeons = useMemo(
    () => dungeons.filter((dungeon) => normalizeDungeonType(dungeon.dungeon_type) !== 'SINGLE'),
    [dungeons]
  )
  const selectedDungeon = multiplayerDungeons.find((dungeon) => dungeon.dungeon_id === selectedDungeonId)
  const currentRoom = rooms.find((room) => room.room_id === currentRoomId) || null
  const currentMember = currentRoom?.members.find((member) => member.player_id === player?.player_id) || null
  const isLeader = !!currentRoom && currentRoom.leader_id === player?.player_id
  const activeDungeonType = normalizeDungeonType(currentRoom?.dungeon_type || selectedDungeon?.dungeon_type || '')
  const selectedCharacterTotal = currentRoom?.members.reduce((total, member) => total + member.character_ids.length, 0) || 0
  const requiredCharacterTotal = activeDungeonType === 'TEAM' || activeDungeonType === 'SERVER_BOSS' ? 20 : currentRoom?.capacity || 5
  const requiredPlayerTotal = activeDungeonType === 'TEAM' ? currentRoom?.capacity || 4 : activeDungeonType === 'SERVER_BOSS' ? 1 : currentRoom?.capacity || 5
  const roomReadyBasic = !!currentRoom && isLeader && currentRoom.status === 'waiting' && currentRoom.members.length > 0 && currentRoom.members.every((member) => member.is_ready && member.character_ids.length > 0)
  const teamReady = activeDungeonType === 'TEAM'
    ? !!currentRoom && currentRoom.members.length >= (currentRoom.capacity || 4) && selectedCharacterTotal >= 20
    : true
  const serverBossReady = activeDungeonType === 'SERVER_BOSS'
    ? !!currentRoom && currentRoom.members.length === 1 && selectedCharacterTotal >= 20
    : true
  const canStart = roomReadyBasic && teamReady && serverBossReady
  const selectedDungeonType = normalizeDungeonType(selectedDungeon?.dungeon_type || '')
  const maxPick = currentRoom?.max_characters_per_member || (selectedDungeonType === 'SERVER_BOSS' ? 20 : selectedDungeonType === 'TEAM' ? 5 : 1)
  const teamCompositionHint = useMemo(() => {
    if (!currentRoom || activeDungeonType !== 'TEAM') return null
    const selectedById = new Map(characters.map((character) => [character.character_id, character]))
    const pickedCharacters = currentRoom.members.flatMap((member) => {
      if (member.player_id === player?.player_id && selectedCharacterIds.length > 0) {
        return selectedCharacterIds.map((characterId) => selectedById.get(characterId) || {
          character_id: characterId,
          name: characterId
        })
      }
      if (member.selected_characters && member.selected_characters.length > 0) {
        return member.selected_characters
      }
      return member.character_ids.map((characterId) => selectedById.get(characterId) || {
        character_id: characterId,
        name: characterId
      })
    })
    const counts: Record<TeamRole, number> = { tank: 0, healer: 0, support: 0, dps: 0 }
    pickedCharacters.forEach((character) => {
      counts[classifyTeamRole(character.profession_type)] += 1
    })
    let score = 100
    const gaps = (Object.keys(TEAM_ROLE_IDEAL) as TeamRole[]).map((role) => {
      const target = TEAM_ROLE_IDEAL[role]
      const value = counts[role]
      const missing = Math.max(0, target.min - value)
      const excess = Math.max(0, value - target.max)
      if (missing > 0) score -= missing * 12
      if (excess > 0) score -= excess * 6
      return {
        role,
        label: target.label,
        value,
        min: target.min,
        max: target.max,
        missing,
        excess,
        status: missing > 0 ? 'missing' : excess > 0 ? 'excess' : 'ok'
      }
    })
    const missingCharacters = Math.max(0, 20 - pickedCharacters.length)
    if (missingCharacters > 0) score -= missingCharacters * 8
    score = Math.max(0, Math.min(100, score))
    const missingPlayers = Math.max(0, (currentRoom.capacity || 4) - currentRoom.members.length)
    const readyMembers = currentRoom.members.filter((member) => member.is_ready && member.character_ids.length > 0).length
    return {
      counts,
      gaps,
      totalCharacters: pickedCharacters.length,
      missingCharacters,
      missingPlayers,
      readyMembers,
      score,
      tier: getTeamRewardTier(score),
      hasRoleGap: gaps.some((gap) => gap.missing > 0)
    }
  }, [currentRoom, activeDungeonType, characters, selectedCharacterIds, player?.player_id])

  useEffect(() => {
    loadInitialData()
    connectRoomSocket()
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(loadRooms, 3000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    loadInvitations()
    const timer = window.setInterval(loadInvitations, 5000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedDungeonId && multiplayerDungeons.length > 0) {
      setSelectedDungeonId(multiplayerDungeons[0].dungeon_id)
    }
  }, [selectedDungeonId, multiplayerDungeons])

  useEffect(() => {
    if (currentRoom?.status === 'in_battle' && currentRoom.battle_id) {
      enterBattle(currentRoom)
    }
  }, [currentRoom?.status, currentRoom?.battle_id])

  useEffect(() => {
    if (currentRoomId) {
      window.localStorage.setItem('gamer_current_room_id', currentRoomId)
      watchRoom(currentRoomId)
      loadRoomChat(currentRoomId)
      updateConnection(currentRoomId, true)
    } else {
      window.localStorage.removeItem('gamer_current_room_id')
      setChatMessages([])
    }
  }, [currentRoomId])

  const mergeRoom = (room: MultiplayerRoom | null | undefined) => {
    if (!room) return
    setRooms((prev) => {
      const exists = prev.some((item) => item.room_id === room.room_id)
      return exists
        ? prev.map((item) => item.room_id === room.room_id ? room : item)
        : [room, ...prev]
    })
  }

  const connectRoomSocket = () => {
    const socket = io(getSocketUrl(), { transports: ['websocket'] })
    socket.on('connect', () => {
      socket.emit('multiplayer_lobby_join', {})
      if (player?.player_id) {
        socket.emit('multiplayer_player_join', { player_id: player.player_id })
      }
      if (currentRoomId) {
        socket.emit('multiplayer_room_join', { room_id: currentRoomId, player_id: player?.player_id })
      }
    })
    socket.on('multiplayer_rooms', (data: { rooms: MultiplayerRoom[] }) => {
      setRooms(data.rooms || [])
    })
    socket.on('multiplayer_room_update', (data: { room: MultiplayerRoom | null; room_id?: string; event_type?: string }) => {
      if (data.room) {
        mergeRoom(data.room)
        if (data.room.members.some((member) => member.player_id === player?.player_id)) {
          setCurrentRoomId(data.room.room_id)
        }
      } else if (data.room_id || currentRoomId) {
        const removedRoomId = data.room_id || currentRoomId
        setRooms((prev) => prev.filter((room) => room.room_id !== removedRoomId))
        setCurrentRoomId(null)
      }
    })
    socket.on('multiplayer_battle_started', (data: { room: MultiplayerRoom; battle_id: string }) => {
      if (!data.room || !data.battle_id) return
      const isMember = data.room.members.some((member) => member.player_id === player?.player_id)
      if (isMember) {
        enterBattle({ ...data.room, battle_id: data.battle_id, status: 'in_battle' })
      }
    })
    socket.on('multiplayer_room_chat', (data: { message: RoomChatMessage }) => {
      if (data.message) {
        setChatMessages((prev) => [...prev.filter((item) => item.message_id !== data.message.message_id), data.message].slice(-50))
      }
    })
    socket.on('multiplayer_room_invitation', (data: { invitation: { invitee_username: string } }) => {
      if (data.invitation) {
        setMessage(`Invited ${data.invitation.invitee_username}`)
        loadInvitations()
      }
    })
    socketRef.current = socket
  }

  const watchRoom = (roomId: string) => {
    if (!socketRef.current || watchedRoomRef.current === roomId) return
    if (watchedRoomRef.current) {
      socketRef.current.emit('multiplayer_room_leave', { room_id: watchedRoomRef.current })
    }
    socketRef.current.emit('multiplayer_room_join', { room_id: roomId, player_id: player?.player_id })
    watchedRoomRef.current = roomId
  }

  const loadInitialData = async () => {
    setLoading(true)
    try {
      const [dungeonResponse, characterResponse, roomResponse] = await Promise.all([
        axios.get('/api/dungeons'),
        axios.get('/api/characters'),
        axios.get('/api/dungeons/multiplayer/rooms')
      ])
      if (dungeonResponse.data.success) {
        setDungeons(dungeonResponse.data.dungeons || [])
      }
      if (characterResponse.data.success) {
        setCharacters(characterResponse.data.characters || [])
      }
      if (roomResponse.data.success) {
        setRooms(roomResponse.data.rooms || [])
      }
      await loadInvitations()
      const currentResponse = await axios.get('/api/dungeons/multiplayer/rooms/current')
      if (currentResponse.data.success && currentResponse.data.room) {
        setCurrentRoomId(currentResponse.data.room.room_id)
        mergeRoom(currentResponse.data.room)
        setSelectedCharacterIds(
          currentResponse.data.room.members.find((member: RoomMember) => member.player_id === player?.player_id)?.character_ids || []
        )
        setMessage('Restored your active multiplayer room')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to load multiplayer room data')
    } finally {
      setLoading(false)
    }
  }

  const loadRooms = async () => {
    try {
      const response = await axios.get('/api/dungeons/multiplayer/rooms')
      if (response.data.success) {
        setRooms(response.data.rooms || [])
      }
    } catch (error) {
      console.error('refresh multiplayer rooms failed', error)
    }
  }

  const loadRoomChat = async (roomId: string) => {
    try {
      const response = await axios.get(`/api/dungeons/multiplayer/rooms/${roomId}/chat`)
      if (response.data.success) {
        setChatMessages(response.data.messages || [])
      }
    } catch (error) {
      console.error('load room chat failed', error)
    }
  }

  const loadInvitations = async () => {
    try {
      const response = await axios.get('/api/dungeons/multiplayer/invitations?status=pending')
      if (response.data.success) {
        setInvitations(response.data.invitations || [])
      }
    } catch (error) {
      console.error('load multiplayer invitations failed', error)
    }
  }

  const updateConnection = async (roomId: string, isOnline: boolean) => {
    try {
      await axios.post(`/api/dungeons/multiplayer/rooms/${roomId}/connection`, { is_online: isOnline })
    } catch (error) {
      console.error('update connection failed', error)
    }
  }

  const toggleCharacter = (characterId: string) => {
    if (selectedCharacterIds.includes(characterId)) {
      setSelectedCharacterIds(selectedCharacterIds.filter((id) => id !== characterId))
      return
    }
    if (selectedCharacterIds.length >= maxPick) {
      setSelectedCharacterIds([...selectedCharacterIds.slice(1), characterId])
      return
    }
    setSelectedCharacterIds([...selectedCharacterIds, characterId])
  }

  const createRoom = async () => {
    if (!selectedDungeonId) {
      setMessage('Please select a multiplayer dungeon')
      return
    }
    try {
      const response = await axios.post('/api/dungeons/multiplayer/rooms', { dungeon_id: selectedDungeonId })
      if (response.data.success) {
        setCurrentRoomId(response.data.room.room_id)
        setRooms((prev) => [response.data.room, ...prev.filter((room) => room.room_id !== response.data.room.room_id)])
        setMessage('Room created. Select characters and ready up.')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to create room')
    }
  }

  const joinRoom = async (room: MultiplayerRoom) => {
    if (selectedCharacterIds.length === 0) {
      setMessage('Please select characters first')
      return
    }
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/rooms/${room.room_id}/join`, {
        character_ids: selectedCharacterIds
      })
      if (response.data.success) {
        setCurrentRoomId(room.room_id)
        setRooms((prev) => prev.map((item) => item.room_id === room.room_id ? response.data.room : item))
        setMessage('Joined room')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to join room')
    }
  }

  const setReady = async (ready: boolean) => {
    if (!currentRoom) return
    if (ready && selectedCharacterIds.length === 0) {
      setMessage('Please select characters first')
      return
    }
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/rooms/${currentRoom.room_id}/ready`, {
        is_ready: ready,
        character_ids: selectedCharacterIds
      })
      if (response.data.success) {
        setRooms((prev) => prev.map((item) => item.room_id === currentRoom.room_id ? response.data.room : item))
        setMessage(ready ? 'Ready' : 'Ready canceled')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to update ready state')
    }
  }

  const leaveRoom = async () => {
    if (!currentRoom) return
    try {
      await axios.post(`/api/dungeons/multiplayer/rooms/${currentRoom.room_id}/leave`)
      setCurrentRoomId(null)
      setMessage('Left room')
      await loadRooms()
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to leave room')
    }
  }

  const sendChat = async () => {
    if (!currentRoom || !chatDraft.trim()) return
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/rooms/${currentRoom.room_id}/chat`, {
        message: chatDraft.trim()
      })
      if (response.data.success) {
        setChatDraft('')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to send chat message')
    }
  }

  const invitePlayer = async () => {
    if (!currentRoom || !inviteName.trim()) return
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/rooms/${currentRoom.room_id}/invite`, {
        username: inviteName.trim()
      })
      if (response.data.success) {
        setInviteName('')
        setMessage(`Invitation sent to ${response.data.invitation.invitee_username}`)
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to invite player')
    }
  }

  const acceptInvitation = async (invitation: RoomInvitation) => {
    if (selectedCharacterIds.length === 0) {
      setMessage('Please select characters before accepting an invitation')
      return
    }
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/invitations/${invitation.invitation_id}/accept`, {
        character_ids: selectedCharacterIds
      })
      if (response.data.success) {
        mergeRoom(response.data.room)
        setCurrentRoomId(response.data.room.room_id)
        setInvitations((prev) => prev.filter((item) => item.invitation_id !== invitation.invitation_id))
        setMessage('Invitation accepted. Joined room.')
        await loadRooms()
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to accept invitation')
      await loadInvitations()
    }
  }

  const rejectInvitation = async (invitation: RoomInvitation) => {
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/invitations/${invitation.invitation_id}/reject`)
      if (response.data.success) {
        setInvitations((prev) => prev.filter((item) => item.invitation_id !== invitation.invitation_id))
        setMessage('Invitation rejected')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to reject invitation')
      await loadInvitations()
    }
  }

  const transferLeader = async (targetPlayerId: string) => {
    if (!currentRoom) return
    try {
      const response = await axios.post(`/api/dungeons/multiplayer/rooms/${currentRoom.room_id}/transfer-leader`, {
        target_player_id: targetPlayerId
      })
      if (response.data.success) {
        mergeRoom(response.data.room)
        setMessage('Leader transferred')
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to transfer leader')
    }
  }

  const startBattle = async () => {
    if (!currentRoom) return
    try {
      const response = await axios.post(`/api/battle/multiplayer/${currentRoom.room_id}/start`, { battle_speed: 1 })
      if (response.data.success) {
        navigate('/battle', {
          state: {
            battle_id: response.data.battle_id,
            dungeon_id: currentRoom.dungeon_id,
            character_ids: selectedCharacterIds,
            battle_already_started: true,
            is_multiplayer: true
          }
        })
      }
    } catch (error: any) {
      setMessage(error.response?.data?.message || 'Failed to start multiplayer battle')
    }
  }

  const enterBattle = (room: MultiplayerRoom) => {
    if (!room.battle_id) return
    navigate('/battle', {
      state: {
        battle_id: room.battle_id,
        dungeon_id: room.dungeon_id,
        battle_already_started: true,
        is_multiplayer: true
      }
    })
  }

  const dungeonName = (dungeonId: string) => dungeons.find((dungeon) => dungeon.dungeon_id === dungeonId)?.name || dungeonId
  const characterName = (characterId: string) => characters.find((character) => character.character_id === characterId)?.name || characterId
  const memberCharacterLabel = (member: RoomMember) => {
    const selected = member.selected_characters && member.selected_characters.length > 0
      ? member.selected_characters
      : member.character_ids.map((characterId) => characters.find((character) => character.character_id === characterId) || { character_id: characterId, name: characterId })
    return selected.map((character) => {
      const name = character.name || character.character_id || 'Unknown'
      const level = character.level ? `Lv.${character.level}` : ''
      const profession = character.profession_type || ''
      return [name, level, profession].filter(Boolean).join(' / ')
    }).join(', ') || 'No characters selected'
  }
  const getFrameworkRuleText = (dungeonType: string) => {
    const normalized = normalizeDungeonType(dungeonType)
    if (normalized === 'TEAM') return '20-player team: 4 players, up to 5 characters each, 20 total characters recommended before battle.'
    if (normalized === 'SERVER_BOSS') return 'Server boss: send 20 characters, then record real damage into server boss progress.'
    if (normalized === 'SQUAD') return '5-player dungeon: up to 5 players, 1 character each.'
    return 'Solo dungeon'
  }

  return (
    <div className="multiplayer-page">
      <div className="multiplayer-container">
        <div className="multiplayer-header">
          <button onClick={() => navigate('/dungeons')} className="room-back">Back to dungeons</button>
          <div>
            <h1>Multiplayer Rooms</h1>
            <p>Create rooms, invite players, ready up, start battles, and review 20-player team clears.</p>
          </div>
          <button onClick={() => navigate('/team-records')} className="room-back">20P Review</button>
        </div>

        {message && <div className="room-message">{message}</div>}

        {loading ? (
          <div className="room-message">Loading...</div>
        ) : (
          <div className="room-layout">
            <section className="room-panel setup-panel">
              <h2>Room Setup</h2>
              <label>
                Multiplayer dungeon
                <select value={selectedDungeonId} onChange={(event) => setSelectedDungeonId(event.target.value)} disabled={!!currentRoom}>
                  {multiplayerDungeons.map((dungeon) => (
                    <option key={dungeon.dungeon_id} value={dungeon.dungeon_id}>
                      {dungeon.name} / {dungeon.attribute_type} / {dungeon.difficulty_key || dungeon.difficulty || 'normal'}
                    </option>
                  ))}
                </select>
              </label>
              {selectedDungeon && (
                <div className="dungeon-summary">
                  <strong>{selectedDungeon.name}</strong>
                  <span>{selectedDungeon.recommendation?.summary || `Recommended level ${selectedDungeon.recommendation?.recommended_level || 1}`}</span>
                  <span>{getFrameworkRuleText(selectedDungeon.dungeon_type)}</span>
                </div>
              )}
              <div className="setup-actions">
                <button onClick={createRoom} disabled={!selectedDungeonId || !!currentRoom}>Create room</button>
                {currentRoom && <button onClick={leaveRoom}>Leave room</button>}
              </div>
              <div className="invitation-inbox">
                <div className="room-title-line">
                  <h2>Invitations</h2>
                  <button onClick={loadInvitations}>Refresh</button>
                </div>
                {invitations.length === 0 ? (
                  <div className="empty-room">No pending invitations.</div>
                ) : (
                  <div className="invitation-list">
                    {invitations.map((invitation) => (
                      <div className="invitation-card" key={invitation.invitation_id}>
                        <div>
                          <strong>{invitation.dungeon?.name || invitation.room_id}</strong>
                          <span>From {invitation.inviter_username || invitation.inviter_id}</span>
                          <span>{invitation.is_available ? 'Waiting for response' : 'Room unavailable'}</span>
                        </div>
                        <div className="room-card-actions">
                          <button onClick={() => acceptInvitation(invitation)} disabled={!invitation.is_available}>Accept</button>
                          <button onClick={() => rejectInvitation(invitation)}>Reject</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="pick-title">Select characters, up to {maxPick}</div>
              <div className="character-room-grid">
                {characters.map((character) => (
                  <button
                    key={character.character_id}
                    className={selectedCharacterIds.includes(character.character_id) ? 'selected' : ''}
                    onClick={() => toggleCharacter(character.character_id)}
                  >
                    <strong>{character.name}</strong>
                    <span>Lv.{character.level} / {character.attribute_type} / {character.profession_type}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="room-panel">
              <div className="room-title-line">
                <h2>Current Room</h2>
                <button onClick={loadRooms}>Refresh</button>
              </div>
              {currentRoom ? (
                <div className="current-room">
                  <div className="room-meta">
                    <strong>{dungeonName(currentRoom.dungeon_id)}</strong>
                    <span>{currentRoom.status} / {currentRoom.members.length}/{currentRoom.capacity}</span>
                  </div>
                  <div className="team-readiness-panel">
                    <div>
                      <span>Players</span>
                      <strong>{currentRoom.members.length}/{requiredPlayerTotal}</strong>
                    </div>
                    <div>
                      <span>Characters</span>
                      <strong>{selectedCharacterTotal}/{requiredCharacterTotal}</strong>
                    </div>
                    <p>{getFrameworkRuleText(currentRoom.dungeon_type)}</p>
                  </div>
                  {teamCompositionHint && (
                    <div className={`team-composition-panel tier-${teamCompositionHint.tier.toLowerCase()}`}>
                      <div className="team-composition-header">
                        <div>
                          <span>20P Composition</span>
                          <strong>{teamCompositionHint.score} / {teamCompositionHint.tier}</strong>
                        </div>
                        <div>
                          <span>Ready</span>
                          <strong>{teamCompositionHint.readyMembers}/{currentRoom.members.length}</strong>
                        </div>
                        <div>
                          <span>Slots</span>
                          <strong>{teamCompositionHint.totalCharacters}/20</strong>
                        </div>
                      </div>
                      {(teamCompositionHint.missingPlayers > 0 || teamCompositionHint.missingCharacters > 0 || teamCompositionHint.hasRoleGap) && (
                        <div className="team-composition-alert">
                          {teamCompositionHint.missingPlayers > 0 && <span>Need {teamCompositionHint.missingPlayers} more player(s)</span>}
                          {teamCompositionHint.missingCharacters > 0 && <span>Need {teamCompositionHint.missingCharacters} more character(s)</span>}
                          {teamCompositionHint.hasRoleGap && <span>Role gaps will raise battle pressure</span>}
                        </div>
                      )}
                      <div className="team-role-grid">
                        {teamCompositionHint.gaps.map((gap) => (
                          <div key={gap.role} className={`team-role-card ${gap.status}`}>
                            <span>{gap.label}</span>
                            <strong>{gap.value}</strong>
                            <small>Target {gap.min}-{gap.max}</small>
                            {gap.missing > 0 && <em>Missing {gap.missing}</em>}
                            {gap.excess > 0 && <em>Over {gap.excess}</em>}
                            {gap.status === 'ok' && <em>OK</em>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="member-list">
                    {currentRoom.members.map((member) => (
                      <div className="member-row" key={member.player_id}>
                        <div>
                          <strong>{member.username}{member.player_id === currentRoom.leader_id ? '锛堟埧涓伙級' : ''}</strong>
                          <span>{memberCharacterLabel(member)}</span>
                          <span>
                            {member.connection_status === 'offline'
                              ? `绂荤嚎锛岄噸杩炲€掕鏃?${member.reconnect_remaining_seconds ?? 0}s`
                              : '鍦ㄧ嚎'}
                          </span>
                        </div>
                        <div className="member-actions">
                          <em className={member.is_ready ? 'ready' : ''}>{member.is_ready ? 'Ready' : 'Not ready'}</em>
                          {isLeader && member.player_id !== currentRoom.leader_id && (
                            <button onClick={() => transferLeader(member.player_id)}>Transfer leader</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="setup-actions">
                    <button onClick={() => setReady(!currentMember?.is_ready)}>
                      {currentMember?.is_ready ? 'Cancel ready' : 'Ready'}
                    </button>
                    <button onClick={startBattle} disabled={!canStart}>Start battle</button>
                    {currentRoom.battle_id && <button onClick={() => enterBattle(currentRoom)}>Enter battle</button>}
                  </div>
                  <div className="room-form-row">
                    <input
                      value={inviteName}
                      onChange={(event) => setInviteName(event.target.value)}
                      placeholder="Invite player by username"
                    />
                    <button onClick={invitePlayer} disabled={!inviteName.trim()}>Invite</button>
                  </div>
                  <div className="room-chat">
                    <div className="room-chat-list">
                      {chatMessages.length === 0 && <div className="room-chat-empty">No room messages yet</div>}
                      {chatMessages.map((item) => (
                        <div className="room-chat-message" key={item.message_id}>
                          <strong>{item.username}</strong>
                          <span>{item.message}</span>
                        </div>
                      ))}
                    </div>
                    <div className="room-form-row">
                      <input
                        value={chatDraft}
                        onChange={(event) => setChatDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            sendChat()
                          }
                        }}
                        placeholder="Send room chat"
                      />
                      <button onClick={sendChat} disabled={!chatDraft.trim()}>Send</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-room">You have not joined a room yet.</div>
              )}

              <h2 className="room-list-heading">Room List</h2>
              <div className="room-list">
                {rooms.length === 0 && <div className="empty-room">No rooms yet.</div>}
                {rooms.map((room) => (
                  <div className="room-card" key={room.room_id}>
                    <div>
                      <strong>{dungeonName(room.dungeon_id)}</strong>
                      <span>{room.status} / {room.members.length}/{room.capacity}</span>
                    </div>
                    <div className="room-card-members">
                      {room.members.map((member) => `${member.username}${member.is_ready ? ' ready' : ''}`).join(', ')}
                    </div>
                    <div className="room-card-actions">
                      {room.status === 'waiting' ? (
                        <button onClick={() => joinRoom(room)} disabled={room.room_id === currentRoomId}>Join / update picks</button>
                      ) : (
                        <button onClick={() => enterBattle(room)} disabled={!room.battle_id}>Enter battle</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

export default MultiplayerRoomPage
