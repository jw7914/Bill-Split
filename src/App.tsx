import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  Calculator,
  CloudCheck,
  LogIn,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserPlus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import './App.css'

type Participant = {
  id: string
  name: string
  discordHandle: string
  discordUserId: string
  share: number
}

type BillItem = {
  id: string
  name: string
  amount: string
  note: string
  assignedUserIds: string[]
}

type DiscordGuild = {
  id: string
  name: string
}

type DiscordChannel = {
  id: string
  name: string
}

type DiscordMember = {
  id: string
  name: string
  username: string
}

type BillSummary = {
  id: string
  billName: string
  updatedAt: string
}

type UserProfile = {
  id: string
  username: string
  globalName: string
  avatar: string
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [allUsers, setAllUsers] = useState<UserProfile[]>([])
  const [billId, setBillId] = useState('')
  const [recentBills, setRecentBills] = useState<BillSummary[]>([])
  const [syncStatus, setSyncStatus] = useState<
    'synced' | 'saving' | 'error' | 'loading'
  >('loading')

  const isInitialMountRef = useRef(true)
  const isUpdatingFromRemoteRef = useRef(false)
  const lastRemoteUpdatedAtRef = useRef<string>('')

  const [billName, setBillName] = useState('')
  const [total, setTotal] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [sendItemized, setSendItemized] = useState(false)
  const [items, setItems] = useState<BillItem[]>([
    {
      id: crypto.randomUUID(),
      name: '',
      amount: '',
      note: '',
      assignedUserIds: [],
    },
  ])
  const [participants, setParticipants] = useState<Participant[]>([])
  const [guilds, setGuilds] = useState<DiscordGuild[]>([])
  const [channels, setChannels] = useState<DiscordChannel[]>([])
  const [members, setMembers] = useState<DiscordMember[]>([])
  const [memberSearch, setMemberSearch] = useState('')
  const [selectedGuildId, setSelectedGuildId] = useState('')
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [discordLoading, setDiscordLoading] = useState(false)
  const [, setDiscordStatus] = useState('')
  const [installLoading, setInstallLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const [statusMessage, setStatusMessage] = useState('')

  const numericTotal = Number(total)
  const validEnteredTotal = Number.isFinite(numericTotal) && numericTotal > 0
  const validItems = items
    .map((item) => ({
      ...item,
      amountValue: Number(item.amount),
    }))
    .filter(
      (item) =>
        item.name.trim().length > 0 &&
        Number.isFinite(item.amountValue) &&
        item.amountValue > 0,
    )
  const itemizedTotal = validItems.reduce(
    (sum, item) => sum + item.amountValue,
    0,
  )
  const effectiveTotal = sendItemized ? itemizedTotal : numericTotal
  const validTotal = Number.isFinite(effectiveTotal) && effectiveTotal > 0
  const selectedParticipantIds = new Set(
    participants
      .map((participant) => participant.discordUserId)
      .filter(Boolean),
  )
  const filteredMembers = members.filter((member) => {
    const query = memberSearch.trim().toLowerCase()

    if (!query) {
      return true
    }

    return (
      member.name.toLowerCase().includes(query) ||
      member.username.toLowerCase().includes(query)
    )
  })

  const splits = useMemo(() => {
    if (!validTotal || participants.length === 0) {
      return participants.map((participant) => ({
        ...participant,
        amount: 0,
        percent: 0,
      }))
    }

    if (!sendItemized) {
      return participants.map((participant) => {
        const amount = effectiveTotal / participants.length

        return {
          ...participant,
          amount,
          percent: 100 / participants.length,
        }
      })
    }

    return participants.map((participant) => {
      const amount = validItems.reduce((sum, item) => {
        if (!item.assignedUserIds.includes(participant.discordUserId)) {
          return sum
        }

        return sum + item.amountValue / item.assignedUserIds.length
      }, 0)

      return {
        ...participant,
        amount,
        percent: effectiveTotal > 0 ? (amount / effectiveTotal) * 100 : 0,
      }
    })
  }, [effectiveTotal, participants, sendItemized, validItems, validTotal])

  const canSend =
    billName.trim().length > 0 &&
    (sendItemized ? itemizedTotal > 0 : validEnteredTotal) &&
    participants.length >= 2 &&
    participants.every((participant) => participant.name.trim()) &&
    (!sendItemized ||
      validItems.every((item) => item.assignedUserIds.length > 0)) &&
    selectedChannelId

  const loadBill = useCallback(async (id: string) => {
    try {
      setSyncStatus('loading')
      const res = await fetch(`/api/bills/${id}`)
      const data = await res.json()

      if (!res.ok || !data.bill) {
        throw new Error(data.error || 'Bill not found')
      }

      const bill = data.bill
      isUpdatingFromRemoteRef.current = true
      lastRemoteUpdatedAtRef.current = bill.updatedAt || ''

      setBillId(bill.id)
      setBillName(bill.billName || '')
      setTotal(bill.total ? String(bill.total) : '')
      setDueDate(bill.dueDate || '')
      setNote(bill.note || '')
      setSendItemized(Boolean(bill.sendItemized))
      setItems(
        Array.isArray(bill.items) && bill.items.length > 0
          ? bill.items.map((it: BillItem) => ({
              id: it.id || crypto.randomUUID(),
              name: it.name || '',
              amount: it.amount != null ? String(it.amount) : '',
              note: it.note || '',
              assignedUserIds: Array.isArray(it.assignedUserIds)
                ? it.assignedUserIds
                : [],
            }))
          : [
              {
                id: crypto.randomUUID(),
                name: '',
                amount: '',
                note: '',
                assignedUserIds: [],
              },
            ],
      )
      setParticipants(Array.isArray(bill.participants) ? bill.participants : [])
      if (bill.selectedGuildId) setSelectedGuildId(bill.selectedGuildId)
      if (bill.selectedChannelId) setSelectedChannelId(bill.selectedChannelId)

      setSyncStatus('synced')

      const url = new URL(window.location.href)
      if (url.searchParams.get('billId') !== bill.id) {
        url.searchParams.set('billId', bill.id)
        window.history.replaceState(null, '', url.toString())
      }
    } catch {
      setSyncStatus('error')
    } finally {
      setTimeout(() => {
        isUpdatingFromRemoteRef.current = false
      }, 100)
    }
  }, [])

  const fetchRecentBills = useCallback(async () => {
    try {
      const res = await fetch('/api/bills')
      const data = await res.json()
      if (res.ok && Array.isArray(data.bills)) {
        setRecentBills(data.bills)
      }
    } catch {
      // ignore errors fetching list
    }
  }, [])

  const createNewBill = useCallback(async () => {
    try {
      setSyncStatus('loading')
      const res = await fetch('/api/bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billName: 'New Shared Bill',
          total: 0,
          sendItemized: false,
          items: [],
          participants: [],
        }),
      })
      const data = await res.json()
      if (res.ok && data.bill) {
        await loadBill(data.bill.id)
        void fetchRecentBills()
      }
    } catch {
      setSyncStatus('error')
    }
  }, [fetchRecentBills, loadBill])

  useEffect(() => {
    async function initSession() {
      const urlParams = new URLSearchParams(window.location.search)
      const requestedId = urlParams.get('billId')

      void fetchRecentBills()

      if (requestedId) {
        await loadBill(requestedId)
      } else {
        await createNewBill()
      }
      isInitialMountRef.current = false
    }

    void initSession()
  }, [createNewBill, fetchRecentBills, loadBill])

  useEffect(() => {
    if (isInitialMountRef.current || !billId || isUpdatingFromRemoteRef.current) {
      return
    }

    setSyncStatus('saving')

    const timer = setTimeout(async () => {
      try {
        const payload = {
          billName,
          total: numericTotal || 0,
          dueDate,
          note,
          sendItemized,
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            amount: Number(item.amount) || 0,
            note: item.note,
            assignedUserIds: item.assignedUserIds,
          })),
          participants,
          selectedGuildId,
          selectedChannelId,
        }

        const res = await fetch(`/api/bills/${billId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await res.json()
        if (res.ok && data.bill) {
          lastRemoteUpdatedAtRef.current = data.bill.updatedAt
          setSyncStatus('synced')
        } else {
          setSyncStatus('error')
        }
      } catch {
        setSyncStatus('error')
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [
    billId,
    billName,
    dueDate,
    items,
    note,
    numericTotal,
    participants,
    selectedChannelId,
    selectedGuildId,
    sendItemized,
  ])

  useEffect(() => {
    if (!billId) return

    const interval = setInterval(async () => {
      if (isUpdatingFromRemoteRef.current || syncStatus === 'saving') {
        return
      }

      try {
        const res = await fetch(`/api/bills/${billId}`)
        const data = await res.json()

        if (res.ok && data.bill) {
          const remoteBill = data.bill
          if (
            remoteBill.updatedAt &&
            remoteBill.updatedAt !== lastRemoteUpdatedAtRef.current
          ) {
            isUpdatingFromRemoteRef.current = true
            lastRemoteUpdatedAtRef.current = remoteBill.updatedAt

            setBillName(remoteBill.billName || '')
            setTotal(remoteBill.total ? String(remoteBill.total) : '')
            setDueDate(remoteBill.dueDate || '')
            setNote(remoteBill.note || '')
            setSendItemized(Boolean(remoteBill.sendItemized))
            setItems(
              Array.isArray(remoteBill.items) && remoteBill.items.length > 0
                ? remoteBill.items.map((it: BillItem) => ({
                    id: it.id || crypto.randomUUID(),
                    name: it.name || '',
                    amount: it.amount != null ? String(it.amount) : '',
                    note: it.note || '',
                    assignedUserIds: Array.isArray(it.assignedUserIds)
                      ? it.assignedUserIds
                      : [],
                  }))
                : [],
            )
            setParticipants(
              Array.isArray(remoteBill.participants)
                ? remoteBill.participants
                : [],
            )
            setSyncStatus('synced')

            setTimeout(() => {
              isUpdatingFromRemoteRef.current = false
            }, 100)
          }
        }

        void fetchRecentBills()
      } catch {
        // ignore background fetch error
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [billId, fetchRecentBills, syncStatus])

  const fetchAuthSession = useCallback(async (selectedUserId?: string) => {
    try {
      const activeId = selectedUserId || localStorage.getItem('activeUserId') || ''
      const res = await fetch(`/api/auth/me?activeUserId=${activeId}`)
      const data = await res.json()

      if (res.ok && data.ok) {
        if (data.activeUser) {
          setCurrentUser(data.activeUser)
          localStorage.setItem('activeUserId', data.activeUser.id)
        }
        if (Array.isArray(data.users)) {
          setAllUsers(data.users)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  function loginWithDiscord() {
    window.location.href = '/api/auth/discord/login'
  }

  function switchUser(userId: string) {
    localStorage.setItem('activeUserId', userId)
    void fetchAuthSession(userId)
  }

  async function logoutUser(userId: string) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
    } catch {
      // ignore logout error
    }
    localStorage.removeItem('activeUserId')
    setCurrentUser(null)
    const remainingUsers = allUsers.filter((u) => u.id !== userId)
    setAllUsers(remainingUsers)

    setGuilds([])
    setChannels([])
    setMembers([])
    setSelectedGuildId('')
    setSelectedChannelId('')

    if (remainingUsers.length > 0) {
      switchUser(remainingUsers[0].id)
    }
  }

  const loadGuilds = useCallback(async () => {
    const activeId = currentUser?.id || localStorage.getItem('activeUserId') || ''

    if (!activeId) {
      setGuilds([])
      setChannels([])
      setMembers([])
      setSelectedGuildId('')
      setSelectedChannelId('')
      setDiscordStatus('Sign in with Discord to view servers.')
      return
    }

    setDiscordLoading(true)
    setDiscordStatus('Loading Discord servers...')

    try {
      const response = await fetch(`/api/discord/user-guilds?userId=${activeId}`)
      const result = await response.json()

      if (!response.ok) {
        setGuilds([])
        setSelectedGuildId('')
        throw new Error(result.error || 'Unable to load Discord servers.')
      }

      const loadedGuilds = result.guilds || []
      setGuilds(loadedGuilds)
      setSelectedGuildId(loadedGuilds[0]?.id || '')
      setDiscordStatus(
        loadedGuilds.length
          ? 'Choose a server, channel, and users.'
          : 'No servers found for this account.',
      )
    } catch (error) {
      setGuilds([])
      setSelectedGuildId('')
      setDiscordStatus(
        error instanceof Error ? error.message : 'Unable to load Discord servers.',
      )
    } finally {
      setDiscordLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const activeUserIdParam = params.get('activeUserId')

    if (activeUserIdParam) {
      localStorage.setItem('activeUserId', activeUserIdParam)
      const url = new URL(window.location.href)
      url.searchParams.delete('activeUserId')
      window.history.replaceState(null, '', url.toString())
    }

    void fetchAuthSession(activeUserIdParam || undefined)
  }, [fetchAuthSession])

  useEffect(() => {
    void loadGuilds()
  }, [loadGuilds])

  async function loadDiscordContext(guildId: string) {
    setDiscordLoading(true)
    setChannels([])
    setMembers([])
    setSelectedChannelId('')
    setParticipants([])
    setMemberSearch('')
    setDiscordStatus('Loading channels and members...')

    try {
      const [channelsResponse, membersResponse] = await Promise.all([
        fetch(`/api/discord/guilds/${guildId}/channels`),
        fetch(`/api/discord/guilds/${guildId}/members`),
      ])
      const channelsResult = await channelsResponse.json()
      const membersResult = await membersResponse.json()

      if (!channelsResponse.ok) {
        throw new Error(
          channelsResult.error || 'Unable to load Discord channels.',
        )
      }

      if (!membersResponse.ok) {
        throw new Error(membersResult.error || 'Unable to load Discord users.')
      }

      setChannels(channelsResult.channels)
      setMembers(membersResult.members)
      setSelectedChannelId(channelsResult.channels[0]?.id || '')
      setDiscordStatus(
        membersResult.members.length
          ? ''
          : 'No users are visible to the bot in this server.',
      )
    } catch (error) {
      setDiscordStatus(
        error instanceof Error ? error.message : 'Unable to load Discord users.',
      )
    } finally {
      setDiscordLoading(false)
    }
  }

  useEffect(() => {
    if (selectedGuildId) {
      void loadDiscordContext(selectedGuildId)
    }
  }, [selectedGuildId])

  async function sendDiscordMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!canSend) {
      setStatus('error')
      setStatusMessage(
        sendItemized
          ? 'Choose a channel, add item amounts, assign every item, and select at least two Discord users.'
          : 'Choose a channel, enter a split amount, and select at least two Discord users.',
      )
      return
    }

    setStatus('sending')
    setStatusMessage('Sending split to Discord...')

    try {
      const response = await fetch('/api/discord/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billName,
          channelId: selectedChannelId,
          total: roundCurrency(effectiveTotal),
          dueDate,
          note,
          itemized: sendItemized,
          items: sendItemized
            ? validItems.map((item) => ({
                name: item.name,
                amount: roundCurrency(item.amountValue),
                note: item.note,
                assignedUserIds: item.assignedUserIds,
              }))
            : [],
          participants: splits.map((participant) => ({
            name: participant.name,
            discordHandle: participant.discordHandle,
            discordUserId: participant.discordUserId,
            amount: roundCurrency(participant.amount),
            percent: participant.percent,
          })),
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to send Discord message.')
      }

      setStatus('sent')
      setStatusMessage(`Sent to Discord. Message ID: ${result.messageId}`)
    } catch (error) {
      setStatus('error')
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to send Discord message.',
      )
    }
  }

  async function openDiscordInstall() {
    setInstallLoading(true)
    setDiscordStatus('Preparing Discord install link...')

    try {
      const response = await fetch('/api/discord/install-url')
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to build Discord install link.')
      }

      window.open(result.installUrl, '_blank', 'noopener,noreferrer')
      setDiscordStatus(
        'Authorize the bot in Discord, then return here and refresh.',
      )
    } catch (error) {
      setDiscordStatus(
        error instanceof Error
          ? error.message
          : 'Unable to build Discord install link.',
      )
    } finally {
      setInstallLoading(false)
    }
  }

  function toggleMember(member: DiscordMember) {
    setParticipants((currentParticipants) => {
      const existingParticipant = currentParticipants.find(
        (participant) => participant.discordUserId === member.id,
      )

      if (existingParticipant) {
        return currentParticipants.filter(
          (participant) => participant.discordUserId !== member.id,
        )
      }

      return [
        ...currentParticipants,
        {
          id: member.id,
          name: member.name,
          discordHandle: `@${member.username}`,
          discordUserId: member.id,
          share: 1,
        },
      ]
    })
  }

  function removeParticipant(participantId: string) {
    setParticipants((currentParticipants) =>
      currentParticipants.filter((participant) => participant.id !== participantId),
    )
  }

  function updateItem(itemId: string, updates: Partial<BillItem>) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId ? { ...item, ...updates } : item,
      ),
    )
  }

  function addItem() {
    setItems((currentItems) => [
      ...currentItems,
      {
        id: crypto.randomUUID(),
        name: '',
        amount: '',
        note: '',
        assignedUserIds: [],
      },
    ])
  }

  function removeItem(itemId: string) {
    setItems((currentItems) =>
      currentItems.filter((item) => item.id !== itemId),
    )
  }

  function toggleItemAssignee(itemId: string, userId: string) {
    setItems((currentItems) =>
      currentItems.map((item) => {
        if (item.id !== itemId) {
          return item
        }

        const assignedUserIds = item.assignedUserIds.includes(userId)
          ? item.assignedUserIds.filter((assignedUserId) => assignedUserId !== userId)
          : [...item.assignedUserIds, userId]

        return { ...item, assignedUserIds }
      }),
    )
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <a href="#" className="flex items-center gap-3 font-semibold">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ReceiptText className="size-5" />
                </span>
                <span>Budget Message</span>
              </a>

              <div className="flex items-center gap-2 border-l border-border pl-3">
                {syncStatus === 'synced' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CloudCheck className="size-3.5" /> Live Sync
                  </span>
                )}
                {syncStatus === 'saving' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                    <RefreshCw className="size-3.5 animate-spin" /> Saving...
                  </span>
                )}
                {syncStatus === 'loading' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    <RefreshCw className="size-3.5 animate-spin" /> Syncing...
                  </span>
                )}
                {syncStatus === 'error' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                    Sync Error
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {recentBills.length > 0 && (
                <select
                  value={billId}
                  onChange={(e) => void loadBill(e.target.value)}
                  className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs font-medium shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label="Recent Bills"
                >
                  {recentBills.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.billName || 'Untitled Bill'} ({b.id.slice(0, 6)})
                    </option>
                  ))}
                </select>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void createNewBill()}
              >
                <Plus className="size-3.5" />
                New Bill
              </Button>

              {currentUser ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={openDiscordInstall}
                    disabled={installLoading}
                  >
                    <UserPlus className="size-3.5" />
                    Add Server
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadGuilds}
                    disabled={discordLoading}
                  >
                    <RefreshCw className="size-3.5" />
                    Refresh
                  </Button>

                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1">
                    {currentUser.avatar ? (
                      <img
                        src={currentUser.avatar}
                        alt={currentUser.globalName}
                        className="size-5 rounded-full"
                      />
                    ) : (
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {currentUser.username[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="text-xs font-medium">
                      @{currentUser.username}
                    </span>

                    {allUsers.length > 1 && (
                      <select
                        value={currentUser.id}
                        onChange={(e) => switchUser(e.target.value)}
                        className="ml-1 h-6 rounded border border-input bg-background px-1 text-[11px] font-medium outline-none"
                        aria-label="Switch User Account"
                      >
                        {allUsers.map((u) => (
                          <option key={u.id} value={u.id}>
                            @{u.username}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      type="button"
                      onClick={() => void logoutUser(currentUser.id)}
                      className="ml-1 flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                      title="Log out"
                      aria-label="Log out"
                    >
                      <LogOut className="size-3.5" />
                    </button>
                  </div>
                </>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={loginWithDiscord}
                >
                  <LogIn className="size-3.5" />
                  Sign in with Discord
                </Button>
              )}
            </div>
          </div>

          {currentUser && (
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px] lg:items-end">
              <div>
                <p className="text-sm text-muted-foreground">Discord target</p>
                <h1 className="mt-1 text-lg font-semibold tracking-normal">
                  Pick where this bill should be sent
                </h1>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Server
                </span>
                <select
                  value={selectedGuildId}
                  onChange={(event) => setSelectedGuildId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  disabled={discordLoading || guilds.length === 0}
                >
                  {guilds.length === 0 && <option value="">No servers</option>}
                  {guilds.map((guild) => (
                    <option key={guild.id} value={guild.id}>
                      {guild.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Channel
                </span>
                <select
                  value={selectedChannelId}
                  onChange={(event) => setSelectedChannelId(event.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  disabled={discordLoading || channels.length === 0}
                >
                  {channels.length === 0 && <option value="">No channels</option>}
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      </header>

      <form
        onSubmit={sendDiscordMessage}
        className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_380px] lg:px-8"
      >
        <section className="space-y-6">
          <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Bill setup</p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal">
                  Start from a blank bill
                </h2>
              </div>
              <ReceiptText className="size-5 text-muted-foreground" />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium">Bill name</span>
                <Input
                  value={billName}
                  onChange={(event) => setBillName(event.target.value)}
                  placeholder="Utilities, dinner, rent..."
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium">Due date</span>
                <Input
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  type="date"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium">Message note</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  placeholder="Payment method, context, or reminders..."
                />
              </label>
            </div>

            <div className="mt-6 border-t border-border pt-6">
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">People</p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal">
                  Select Discord users and split together
                </h2>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={(event) => setMemberSearch(event.target.value)}
                  className="pl-9"
                  placeholder="Search users"
                  disabled={members.length === 0}
                />
              </div>
            </div>

              <div className="grid gap-3 md:grid-cols-2">
              {filteredMembers.slice(0, 24).map((member) => {
                const selected = selectedParticipantIds.has(member.id)

                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member)}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-muted'
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {member.name}
                      </span>
                      <span
                        className={`block text-xs ${
                          selected
                            ? 'text-primary-foreground/70'
                            : 'text-muted-foreground'
                        }`}
                      >
                        @{member.username}
                      </span>
                    </span>
                    <UserPlus className="size-4 shrink-0" />
                  </button>
                )
              })}
            </div>

              {members.length === 0 && (
              <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                No Discord users loaded. Enable the bot&apos;s Server Members
                Intent in Discord Developer Portal, then refresh.
              </p>
            )}
            </div>

            <div className="mt-6 border-t border-border pt-6">
              <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Split mode</p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal">
                  Choose how amounts are calculated
                </h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={!sendItemized ? 'default' : 'outline'}
                  onClick={() => setSendItemized(false)}
                >
                  Equal Split
                </Button>
                <Button
                  type="button"
                  variant={sendItemized ? 'default' : 'outline'}
                  onClick={() => setSendItemized(true)}
                >
                  Itemized
                </Button>
                {sendItemized && (
                  <>
                    <Button type="button" variant="outline" onClick={addItem}>
                      <Plus className="size-4" />
                      Add Item
                    </Button>
                  </>
                )}
              </div>
            </div>

              {!sendItemized ? (
              <div className="grid gap-4 rounded-lg bg-muted p-4 md:grid-cols-[220px_1fr] md:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Total amount</span>
                  <Input
                    value={total}
                    onChange={(event) => setTotal(event.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </label>
                <p className="text-sm text-muted-foreground">
                  Equal Split divides this amount evenly across every selected
                  Discord user.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="grid gap-3 md:grid-cols-[1fr_130px_1fr_36px] md:items-end">
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Item
                          </span>
                          <Input
                            value={item.name}
                            onChange={(event) =>
                              updateItem(item.id, { name: event.target.value })
                            }
                            placeholder="Tacos, rent, internet..."
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Amount
                          </span>
                          <Input
                            value={item.amount}
                            onChange={(event) =>
                              updateItem(item.id, { amount: event.target.value })
                            }
                            inputMode="decimal"
                            placeholder="0.00"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Note
                          </span>
                          <Input
                            value={item.note}
                            onChange={(event) =>
                              updateItem(item.id, { note: event.target.value })
                            }
                            placeholder="Optional"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.id)}
                          disabled={items.length <= 1}
                          aria-label={`Remove ${item.name || 'item'}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className="mt-3 border-t border-border pt-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Assigned users
                        </p>
                        {participants.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Select Discord users before assigning line items.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {participants.map((participant) => {
                              const assigned = item.assignedUserIds.includes(
                                participant.discordUserId,
                              )

                              return (
                                <button
                                  key={participant.id}
                                  type="button"
                                  onClick={() =>
                                    toggleItemAssignee(
                                      item.id,
                                      participant.discordUserId,
                                    )
                                  }
                                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                                    assigned
                                      ? 'border-primary bg-primary text-primary-foreground'
                                      : 'border-border bg-card text-muted-foreground hover:bg-muted'
                                  }`}
                                >
                                  {participant.name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
                  <span className="text-muted-foreground">
                    Valid itemized rows: {validItems.length}
                  </span>
                  <span className="font-medium">
                    Item total: {formatCurrency(itemizedTotal)}
                  </span>
                </div>
              </>
            )}
            </div>
          </div>

        </section>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:self-start">
          <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Preview</p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal">
                  Discord message
                </h2>
              </div>
              <Calculator className="size-5 text-muted-foreground" />
            </div>

            <div className="rounded-lg border border-border bg-background p-4 text-sm">
              <p className="font-semibold">{billName || 'Untitled bill'}</p>
              <p className="mt-1 text-muted-foreground">
                Total: {validTotal ? formatCurrency(effectiveTotal) : '$0.00'}
              </p>
              {dueDate && (
                <p className="mt-1 text-muted-foreground">Due: {dueDate}</p>
              )}
              {note && <p className="mt-3 text-muted-foreground">{note}</p>}
              {sendItemized && validItems.length > 0 && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="mb-2 font-medium">Items</p>
                  <div className="space-y-2">
                    {validItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3"
                      >
                        <span className="text-muted-foreground">
                          {item.name}
                          {item.note && (
                            <span className="block text-xs">{item.note}</span>
                          )}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(item.amountValue)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-border pt-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Split together</p>
                  <p className="text-sm text-muted-foreground">
                    {splits.length} selected
                  </p>
                </div>
                <span className="text-sm font-medium">
                  {validTotal ? formatCurrency(effectiveTotal) : '$0.00'} total
                </span>
              </div>

              {splits.length === 0 ? (
                <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                  Select Discord users from the People block.
                </p>
              ) : (
                <div className="space-y-3">
                  {splits.map((participant) => (
                    <div
                      key={participant.id}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {participant.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {participant.discordHandle}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold">
                            {formatCurrency(participant.amount)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {participant.percent.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                          {sendItemized
                            ? `${validItems.filter((item) => item.assignedUserIds.includes(participant.discordUserId)).length} assigned items`
                            : 'Even split'}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeParticipant(participant.id)}
                          aria-label={`Remove ${participant.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button
              type="submit"
              className="mt-5 w-full"
              disabled={!canSend || status === 'sending'}
            >
              <Send className="size-4" />
              {status === 'sending' ? 'Sending...' : 'Send to Discord'}
            </Button>

            {statusMessage && (
              <p
                className={`mt-3 text-sm ${
                  status === 'error' ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {statusMessage}
              </p>
            )}
          </section>
        </aside>
      </form>
    </main>
  )
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function formatCurrency(value: number) {
  return currencyFormatter.format(roundCurrency(value))
}

export default App
