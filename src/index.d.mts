import type { CoreOptions, RequestCallback, Response, Request } from './index.js'

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
export const cookie: typeof request.cookie
export const jar: typeof request.jar
export const defaults: typeof request.defaults
export const forever: typeof request.forever
export const promise: typeof request.promise
export const paginate: typeof request.paginate
export const closePool: typeof request.closePool
export const initParams: typeof request.initParams
export const Request: typeof request.Request
export { del as delete }

export type { CoreOptions, RequestCallback, Response }
export type { RetryOptions, HookOptions, PaginationOptions, BeforeRequestHook, AfterResponseHook, RequestFunction, Defaults, Headers, Static } from './index.js'
export type { HttpCache, MockApi, MockSpec, MockMatcher, MockHandler, ProgressEvent, DnsLookup } from './index.js'