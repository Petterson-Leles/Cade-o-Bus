import { getDeviceInfo } from '@zos/device'

export const { width: DEVICE_WIDTH, height: DEVICE_HEIGHT } = getDeviceInfo()

// As cores ficam em ./colors (sem APIs do relógio) e são reexportadas aqui.
export * from './colors'
