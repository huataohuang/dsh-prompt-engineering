/**
 * 纯 Node 的 tar/gzip 条目读取：只为校验压缩包内容，避免依赖各平台的 tar 命令
 * （Windows 上 bsdtar 不一定在 PATH，Git Bash 的 tar 又可能不认识某些参数）。
 * 支持 USTAR（含 prefix 字段）、GNU 长文件名（typeflag L）与 PAX 头跳过。
 */
import { gunzipSync } from 'node:zlib'

/** 按 NUL 截断的字段解码。 */
function field(bytes) {
  let end = bytes.length
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) { end = i; break }
  }
  return new TextDecoder('utf-8').decode(bytes.subarray(0, end))
}

/**
 * 读取压缩包内的条目名。
 * @param buffer - .tgz 或未压缩 tar 的内容。
 * @returns 条目名数组，含目录条目，顺序与包内一致。
 */
export function listTarEntries(buffer) {
  const isGzip = buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
  const data = isGzip ? gunzipSync(buffer) : buffer
  const names = []
  let offset = 0
  let longName = null
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    let onlyZero = true
    for (const byte of header) { if (byte !== 0) { onlyZero = false; break } }
    if (onlyZero) break
    const size = Number.parseInt(field(header.subarray(124, 136)).trim(), 8) || 0
    const typeFlag = String.fromCharCode(header[156])
    const body = data.subarray(offset + 512, offset + 512 + size)
    if (typeFlag === 'L') {
      longName = field(body).replace(/\0+$/, '')
      offset += 512 + Math.ceil(size / 512) * 512
      continue
    }
    if (typeFlag === 'x' || typeFlag === 'g') {
      offset += 512 + Math.ceil(size / 512) * 512
      continue
    }
    const name = field(header.subarray(0, 100))
    const prefix = field(header.subarray(345, 500))
    names.push(longName !== null ? longName : (prefix === '' ? name : prefix + '/' + name))
    longName = null
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return names
}
