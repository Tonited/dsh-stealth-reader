// 文本解码（纯函数，可单测）。
//
// 中文 txt 最常见的灾难：GBK/GB18030 文件被当成 UTF-8 读 → 全文乱码。
// 策略：UTF-8 严格解码优先（失败即回退，不会误伤合法 UTF-8），回退 GB18030，
// 并用中文统计特征校验回退结果（防止把二进制垃圾"解"成半屏怪字）。

export type DecodedEncoding = 'utf-8' | 'gb18030'

export interface DecodeResult {
  text: string
  encoding: DecodedEncoding
  /** 校验失败时的原因（成功时为 undefined）。 */
  error?: string
}

/** 严格 UTF-8 解码；遇到非法字节序列返回 undefined 而不是替换字符。 */
export function tryDecodeUtf8(bytes: Uint8Array): string | undefined {
  if (hasBom(bytes)) {
    // 带 BOM：合法 UTF-8 的强证据，解码失败也算失败（文件本身坏了）。
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(3))
    } catch {
      return undefined
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** GB18030 解码（宽松：它是很多中文文件的默认猜测）。 */
export function decodeGb18030(bytes: Uint8Array): string {
  try {
    return new TextDecoder('gb18030', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

/**
 * 回退结果是否"看起来像中文文本"。
 *
 * 重要：GB18030 只有一个字节就几乎总能解出东西（它是单/多字节混合编码），
 * 所以**解码成功 ≠ 内容正确**，必须再校验一次。
 */
export function looksLikeText(text: string): boolean {
  if (!text) return false
  // NUL 是二进制文件的强特征
  if (text.includes('\u0000')) return false

  // 全空白不算文本（空白文件的"解码成功"没有意义）
  if (text.trim().length === 0) return false

  const sample = text.slice(0, 6000)
  if (sample.length === 0) return false

  let suspicious = 0
  let cjk = 0
  for (const char of sample) {
    const code = char.codePointAt(0) ?? 0
    // 常见的中文扩展区 + CJK 标点
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x303f)) cjk += 1
    else if (
      code === 0xfffd || // 替换字符
      (code >= 0xe000 && code <= 0xf8ff) || // 私用区：乱码的典型落点
      (code >= 0x0080 && code <= 0x009f) // C1 控制字符
    ) {
      suspicious += 1
    }
  }

  return suspicious / sample.length < 0.05 && (cjk > 0 || sample.length < 200)
}

export function hasBom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

/**
 * 把字节解码为文本。
 *
 * 顺序：UTF-8（严格）→ GB18030（带校验）。
 * 两者都不成立时**仍然返回 GB18030 的结果**并附带 `error`，
 * 让调用方可以把这本书标为"疑似乱码"，而不是白白丢掉整本书。
 */
export function decodeText(bytes: Uint8Array): DecodeResult {
  // 注意：TextDecoder 对空输入返回空字符串且**不抛错**，所以必须显式判断。
  if (!bytes || bytes.length === 0) {
    return { text: '', encoding: 'utf-8', error: '文件是空的' }
  }

  const utf8 = tryDecodeUtf8(bytes)
  if (utf8 !== undefined) return { text: utf8, encoding: 'utf-8' }

  const gb = decodeGb18030(bytes)
  if (looksLikeText(gb)) return { text: gb, encoding: 'gb18030' }

  return {
    text: gb,
    encoding: 'gb18030',
    error: '无法识别文件编码（内容不像文本，可能是二进制文件）',
  }
}
