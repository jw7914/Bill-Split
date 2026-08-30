import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Calculator,
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

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

function App() {
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

  useEffect(() => {
    void loadGuilds()
  }, [])

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

  async function loadGuilds() {
    setDiscordLoading(true)
    setDiscordStatus('Loading Discord servers...')

    try {
      const response = await fetch('/api/discord/guilds')
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to load Discord servers.')
      }

      setGuilds(result.guilds)
      setSelectedGuildId(result.guilds[0]?.id || '')
      setDiscordStatus(
        result.guilds.length
          ? 'Choose a server, channel, and users.'
          : 'The bot is not in any servers yet.',
      )
    } catch (error) {
      setDiscordStatus(
        error instanceof Error ? error.message : 'Unable to load Discord servers.',
      )
    } finally {
      setDiscordLoading(false)
    }
  }

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
          <a href="#" className="flex items-center gap-3 font-semibold">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ReceiptText className="size-5" />
            </span>
            <span>Budget Message</span>
          </a>
            <div className="flex flex-wrap items-center gap-2">
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
            </div>
          </div>

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
