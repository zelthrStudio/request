import request from './index.js'

export default request
export const get = request.get
export const head = request.head
export const options = request.options
export const post = request.post
export const put = request.put
export const patch = request.patch
export const del = request.del
export const promise = request.promise
export const defaults = request.defaults
export const initParams = request.initParams
export const Request = request.Request
export { del as delete }
