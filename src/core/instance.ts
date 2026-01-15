import { hostname } from 'os'
import { randomUUID } from 'crypto'

const MAX_INSTANCE_ID_LENGTH = 128
const RANDOM_SUFFIX_LENGTH = 8

type PlatformConfig = {
  prefix: string
  env?: string | string[]
  presence?: string | string[]
  extract?: () => string | null
}

const PLATFORMS: PlatformConfig[] = [
  {
    prefix: 'lambda',
    extract: () => {
      const logStream = process.env.AWS_LAMBDA_LOG_STREAM_NAME
      if (!logStream) return null
      const match = logStream.match(/\[.*?\](.+)$/)
      return match?.[1] ?? logStream.slice(-32)
    },
  },
  { prefix: 'aca', env: 'CONTAINER_APP_REPLICA_NAME' },
  { prefix: 'azure', env: 'WEBSITE_INSTANCE_ID' },
  { prefix: 'fly', env: ['FLY_MACHINE_ID', 'FLY_ALLOC_ID'] },
  { prefix: 'railway', env: 'RAILWAY_REPLICA_ID' },
  { prefix: 'render', env: 'RENDER_INSTANCE_ID' },
  { prefix: 'heroku', env: 'DYNO' },
  {
    prefix: 'gcrjob',
    extract: () => {
      const execution = process.env.CLOUD_RUN_EXECUTION
      if (!execution) return null
      return `${execution}-${process.env.CLOUD_RUN_TASK_INDEX ?? '0'}`
    },
  },
  {
    prefix: 'gcr',
    extract: () => {
      const revision = process.env.K_REVISION
      if (!revision) return null
      return `${revision}-${hostname()}`
    },
  },
  { prefix: 'ecs', presence: ['ECS_CONTAINER_METADATA_URI_V4', 'ECS_CONTAINER_METADATA_URI'] },
  { prefix: 'k8s', presence: 'KUBERNETES_SERVICE_HOST' },
]

function getEnvValue(keys: string | string[]): string | undefined {
  const keyArray = Array.isArray(keys) ? keys : [keys]
  for (const key of keyArray) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

function hasEnvPresence(keys: string | string[]): boolean {
  const keyArray = Array.isArray(keys) ? keys : [keys]
  return keyArray.some((key) => process.env[key] !== undefined)
}

function detectPlatform(): { prefix: string; identifier: string } | null {
  for (const config of PLATFORMS) {
    if (config.extract) {
      const id = config.extract()
      if (id) return { prefix: config.prefix, identifier: id }
      continue
    }

    if (config.env) {
      const value = getEnvValue(config.env)
      if (value) return { prefix: config.prefix, identifier: value }
      continue
    }

    if (config.presence && hasEnvPresence(config.presence)) {
      return { prefix: config.prefix, identifier: hostname() }
    }
  }
  return null
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function buildInstanceId(identifier: string, pid: number, random: string): string {
  const slugified = slugify(identifier)
  const pidStr = String(pid)
  const suffixLength = 1 + pidStr.length + 1 + random.length
  const maxIdentifierLength = Math.max(1, MAX_INSTANCE_ID_LENGTH - suffixLength)
  const truncatedIdentifier = slugified.slice(0, maxIdentifierLength)

  return `${truncatedIdentifier}-${pidStr}-${random}`
}

/**
 * Generates a unique instance identifier for this SDK process.
 *
 * Format: {identifier}-{pid}-{random8}
 * - identifier: platform prefix + env value, or hostname if no platform detected
 * - pid: process ID
 * - random8: 8-char random suffix
 */
export function generateInstanceId(): string {
  const pid = process.pid
  const random = randomUUID().slice(0, RANDOM_SUFFIX_LENGTH)

  const detected = detectPlatform()
  const identifier = detected ? `${detected.prefix}-${detected.identifier}` : hostname()

  return buildInstanceId(identifier, pid, random)
}
