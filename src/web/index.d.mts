import type { WebOptions, RequestCallback, WebResponse, WebRequest } from './index.js'

// Copyright 2026 zelthrStudio. Licensed under the Apache License, Version 2.0.

declare const request: typeof import('./index.js')

export default request
export const get: typeof request.get
export const head: typeof request.head
export const options: typeof request.options
export const post: typeof request.post
export const put: typeof request.put
export const patch: typeof request.patch
export const del: typeof request.del
export const promise: typeof request.promise
export const defaults: typeof request.defaults
export { del as delete }

export type { WebOptions, RequestCallback, WebResponse, WebRequest }