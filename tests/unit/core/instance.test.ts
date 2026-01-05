import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('os', () => ({
  hostname: vi.fn(() => 'test-hostname'),
}))

describe('generateInstanceId', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('falls back to hostname when no platform is detected', async () => {
    const { generateInstanceId } = await import('../../../src/core/instance.ts')
    const id = generateInstanceId()

    expect(id).toMatch(/^testhostname-\d+-[a-f0-9]{8}$/)
  })

  describe('AWS Lambda', () => {
    it('extracts instance ID from log stream with version bracket', async () => {
      process.env.AWS_LAMBDA_LOG_STREAM_NAME =
        '2024/01/15/[$LATEST]/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^lambdaa1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6-\d+-[a-f0-9]{8}$/)
    })

    it('extracts instance ID from log stream with numeric version', async () => {
      process.env.AWS_LAMBDA_LOG_STREAM_NAME = '2024/03/20/[42]/abc123def456ghi789'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^lambdaabc123def456ghi789-\d+-[a-f0-9]{8}$/)
    })

    it('uses last 32 chars when log stream has no bracket pattern', async () => {
      process.env.AWS_LAMBDA_LOG_STREAM_NAME =
        'some-unusual-format-without-brackets-12345678901234567890123456789012'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^lambda12345678901234567890123456789012-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Azure Container Apps', () => {
    it('uses CONTAINER_APP_REPLICA_NAME', async () => {
      process.env.CONTAINER_APP_REPLICA_NAME = 'my-containerapp--20mh1s9-86c8c4b497-zx9bq'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^acamycontainerapp20mh1s986c8c4b497zx9bq-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Azure Functions / App Service', () => {
    it('uses WEBSITE_INSTANCE_ID', async () => {
      process.env.WEBSITE_INSTANCE_ID = 'f3c2a1b0d9e8f7c6b5a4d3c2b1a09876'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^azuref3c2a1b0d9e8f7c6b5a4d3c2b1a09876-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Fly.io', () => {
    it('uses FLY_MACHINE_ID when available', async () => {
      process.env.FLY_MACHINE_ID = '4d891de2f66489'
      process.env.FLY_ALLOC_ID = 'should-not-use-this'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^fly4d891de2f66489-\d+-[a-f0-9]{8}$/)
    })

    it('falls back to FLY_ALLOC_ID when FLY_MACHINE_ID is not set', async () => {
      process.env.FLY_ALLOC_ID = '5e902ef3g77590'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^fly5e902ef3g77590-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Railway', () => {
    it('uses RAILWAY_REPLICA_ID', async () => {
      process.env.RAILWAY_REPLICA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^railwaya1b2c3d4e5f67890abcdef1234567890-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Render', () => {
    it('uses RENDER_INSTANCE_ID', async () => {
      process.env.RENDER_INSTANCE_ID = 'srv-abc123def456ghi789'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^rendersrvabc123def456ghi789-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Heroku', () => {
    it('uses DYNO for web process', async () => {
      process.env.DYNO = 'web.1'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^herokuweb1-\d+-[a-f0-9]{8}$/)
    })

    it('uses DYNO for worker process', async () => {
      process.env.DYNO = 'worker.3'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^herokuworker3-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Google Cloud Run Jobs', () => {
    it('combines CLOUD_RUN_EXECUTION with CLOUD_RUN_TASK_INDEX', async () => {
      process.env.CLOUD_RUN_EXECUTION = 'my-job-abc123'
      process.env.CLOUD_RUN_TASK_INDEX = '5'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^gcrjobmyjobabc1235-\d+-[a-f0-9]{8}$/)
    })

    it('defaults CLOUD_RUN_TASK_INDEX to 0 when not set', async () => {
      process.env.CLOUD_RUN_EXECUTION = 'my-job-xyz789'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^gcrjobmyjobxyz7890-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Google Cloud Run Services', () => {
    it('combines K_REVISION with hostname', async () => {
      process.env.K_REVISION = 'hello-world.00001-abc'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^gcrhelloworld00001abctesthostname-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('AWS ECS', () => {
    it('uses hostname when ECS_CONTAINER_METADATA_URI_V4 is present', async () => {
      process.env.ECS_CONTAINER_METADATA_URI_V4 = 'http://169.254.170.2/v4/abc123def456'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^ecstesthostname-\d+-[a-f0-9]{8}$/)
    })

    it('uses hostname when ECS_CONTAINER_METADATA_URI is present (v3 fallback)', async () => {
      process.env.ECS_CONTAINER_METADATA_URI = 'http://169.254.170.2/v3/abc123def456'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^ecstesthostname-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('Kubernetes', () => {
    it('uses hostname when KUBERNETES_SERVICE_HOST is present', async () => {
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^k8stesthostname-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('platform priority', () => {
    it('prefers Lambda over Kubernetes when both are set', async () => {
      process.env.AWS_LAMBDA_LOG_STREAM_NAME = '2024/01/15/[$LATEST]/lambda-instance-id'
      process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^lambdalambdainstanceid-\d+-[a-f0-9]{8}$/)
    })

    it('prefers Cloud Run Jobs over Cloud Run Services', async () => {
      process.env.CLOUD_RUN_EXECUTION = 'job-execution-123'
      process.env.CLOUD_RUN_TASK_INDEX = '0'
      process.env.K_REVISION = 'service-revision-456'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^gcrjobjobexecution1230-\d+-[a-f0-9]{8}$/)
    })
  })

  describe('ID format consistency', () => {
    it('always produces {identifier}-{pid}-{random8} format', async () => {
      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      const parts = id.split('-')
      expect(parts.length).toBe(3)
      expect(parts[1]).toMatch(/^\d+$/)
      expect(parts[2]).toMatch(/^[a-f0-9]{8}$/)
    })

    it('slugifies special characters from identifiers', async () => {
      process.env.DYNO = 'web.1-special_chars!'

      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id = generateInstanceId()

      expect(id).toMatch(/^herokuweb1specialchars-\d+-[a-f0-9]{8}$/)
    })

    it('generates unique IDs on each call due to random suffix', async () => {
      const { generateInstanceId } = await import('../../../src/core/instance.ts')
      const id1 = generateInstanceId()
      const id2 = generateInstanceId()

      expect(id1).not.toBe(id2)
    })
  })
})
