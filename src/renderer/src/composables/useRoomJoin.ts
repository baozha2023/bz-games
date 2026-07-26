import type { Router } from 'vue-router'
import type { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { DEFAULT_RELAY_PUBLIC_HOST } from '../../../shared/AppConstants'
import type { AppSettings } from '../../../shared/types'
import { useRoomStore } from '../stores/useRoomStore'
import { useSettingsStore } from '../stores/useSettingsStore'

type MessageApi = ReturnType<typeof useMessage>

interface JoinRoomOptions {
  gameId: string
  address: string
  version?: string
  password?: string
  router: Router
  message: MessageApi
  saveLastAddress?: boolean
  fromSteam?: boolean
  close?: () => void
}

export const normalizeRoomJoinAddress = (address: string) => {
  const trimmed = address.trim()
  const relayPattern = new RegExp(`^${escapeRegExp(DEFAULT_RELAY_PUBLIC_HOST)}:\\d+$`, 'i')
  if (relayPattern.test(trimmed) || /^(ws|wss):\/\//i.test(trimmed)) return trimmed
  if (/^https:\/\//i.test(trimmed)) return `wss://${trimmed.slice('https://'.length)}`
  if (/^http:\/\//i.test(trimmed)) return `ws://${trimmed.slice('http://'.length)}`
  return `ws://${trimmed}`
}

export const useRoomJoin = () => {
  const { t } = useI18n()
  const roomStore = useRoomStore()
  const settingsStore = useSettingsStore()

  const joinErrorText = (error?: string) => {
    if (error === 'version_mismatch') return t('room.joinError.versionMismatch')
    if (error === 'room_full') return t('room.joinError.roomFull')
    if (error === 'game_started') return t('room.joinError.gameStarted')
    if (error === 'game_id_mismatch') return t('room.joinError.gameIdMismatch')
    if (error === 'kicked') return t('room.youWereKicked')
    if (error === 'own_room') return t('room.joinError.ownRoom')
    if (error === 'password_required') return t('room.joinError.passwordRequired')
    if (error === 'password_incorrect') return t('room.joinError.passwordIncorrect')
    if (error === 'manifestInvalid') return t('room.joinError.manifestInvalid')
    if (error === 'gameTypeNotMultiplayer') return t('room.joinError.gameTypeNotMultiplayer')
    if (error === 'multiplayerConfigMissing') return t('room.joinError.multiplayerConfigMissing')
    if (error === 'platformVersionMismatch') return t('room.joinError.platformVersionMismatch')
    return error || t('gameDetail.joinFail')
  }

  const joinRoomByAddress = async (options: JoinRoomOptions) => {
    const address = normalizeRoomJoinAddress(options.address)
    try {
      const res = await roomStore.joinRoom(options.gameId, address, options.version, options.password?.trim())
      if (!res.success) {
        options.message.error(joinErrorText(res.error))
        return { success: false, address }
      }
      if (options.saveLastAddress) {
        await saveLastJoinAddress(address)
      }
      options.close?.()
      await options.router.push({
        name: 'Room',
        params: { id: options.gameId },
        query: options.fromSteam ? { fromSteam: '1' } : undefined
      })
      return { success: true, address }
    } catch (error: any) {
      options.message.error(error?.message || t('gameDetail.joinFail'))
      return { success: false, address }
    }
  }

  const saveLastJoinAddress = async (address: string) => {
    try {
      const currentSettings = settingsStore.settings || (await window.electronAPI.settings.get())
      await settingsStore.saveSettings({
        ...(currentSettings as AppSettings),
        lastJoinRoomAddress: address,
      })
    } catch {}
  }

  return {
    joinRoomByAddress,
    joinErrorText,
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
