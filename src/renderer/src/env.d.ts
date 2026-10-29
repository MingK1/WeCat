/// <reference types="vite/client" />

import type { WeCatApi } from '../../shared/contracts'

declare global {
  interface Window {
    wecat: WeCatApi
  }
}

export {}
