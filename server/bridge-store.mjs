export const BRIDGE_CONSTANTS = {
  clientLeaseMs: 90_000,
  clientCullGraceMs: 5 * 60_000,
  commandTimeoutMs: 120_000,
  defaultPullWaitMs: 25_000,
  maxPullWaitMs: 30_000,
  defaultExecWaitMs: 20_000,
  maxExecWaitMs: 60_000,
}

export class BridgeStore {
  constructor(now = () => Date.now()) {
    this.now = now
    this.clients = new Map()
    this.queues = new Map()
    this.execs = new Map()
    this.pullSignals = new Map()
    this.execSignals = new Map()
  }

  ensureQueue(clientId) {
    const queue = this.queues.get(clientId)
    if (queue) return queue
    const next = []
    this.queues.set(clientId, next)
    return next
  }

  isClientOnline(client) {
    return client.leaseExpiresAt > this.now()
  }

  signalPullClient(clientId) {
    const waiters = this.pullSignals.get(clientId)
    if (!waiters || waiters.size === 0) return

    const waiter = waiters.values().next().value
    if (!waiter) return
    waiters.delete(waiter)
    waiter()
  }

  signalExec(execId) {
    const waiters = this.execSignals.get(execId)
    if (!waiters || waiters.size === 0) return

    for (const waiter of waiters) {
      waiter()
    }

    waiters.clear()
    this.execSignals.delete(execId)
  }

  async waitForPullSignal(clientId, waitMs) {
    if (waitMs <= 0) return

    const waiters = this.pullSignals.get(clientId) || new Set()
    await new Promise((resolve) => {
      const onSignal = () => {
        clearTimeout(timeout)
        waiters.delete(onSignal)
        resolve()
      }

      const timeout = setTimeout(() => {
        waiters.delete(onSignal)
        resolve()
      }, waitMs)

      waiters.add(onSignal)
      this.pullSignals.set(clientId, waiters)
    })
  }

  async waitForExecSignal(execId, waitMs) {
    if (waitMs <= 0) return

    const waiters = this.execSignals.get(execId) || new Set()
    await new Promise((resolve) => {
      const onSignal = () => {
        clearTimeout(timeout)
        waiters.delete(onSignal)
        resolve()
      }

      const timeout = setTimeout(() => {
        waiters.delete(onSignal)
        resolve()
      }, waitMs)

      waiters.add(onSignal)
      this.execSignals.set(execId, waiters)
    })
  }

  cleanup() {
    const current = this.now()

    for (const [clientId, client] of this.clients.entries()) {
      if (client.leaseExpiresAt + BRIDGE_CONSTANTS.clientCullGraceMs <= current) {
        this.clients.delete(clientId)
        this.queues.delete(clientId)
      }
    }

    for (const record of this.execs.values()) {
      if (
        (record.status === "pending" || record.status === "dispatched")
        && record.createdAt + BRIDGE_CONSTANTS.commandTimeoutMs <= current
      ) {
        record.status = "timeout"
        record.error = "Bridge command timeout"
        record.completedAt = current
        record.updatedAt = current
        this.signalExec(record.execId)
      }
    }

    for (const queue of this.queues.values()) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const execId = queue[index]
        const record = this.execs.get(execId)
        if (!record || record.status !== "pending") {
          queue.splice(index, 1)
        }
      }
    }
  }
}
