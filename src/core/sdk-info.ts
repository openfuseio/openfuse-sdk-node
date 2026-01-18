import pkg from '../../package.json' with { type: 'json' }

export const SDK_NAME = 'openfuse-node'
export const SDK_VERSION = pkg.version
export const USER_AGENT = `${SDK_NAME}/${SDK_VERSION}`
