/** A server capability, not an individual identity. Only the caller assigns policy/actor labels. */
export function createBearerVerifier(token: string): (authorization: string | undefined) => Promise<boolean> {
  if (typeof token!=='string' || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('Invalid bearer credential')
  let material: Promise<{key: CryptoKey;signature: ArrayBuffer}> | undefined
  return async authorization => {
    const candidate=/^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(authorization??'')?.[1]
    if (!candidate) return false
    const {key,signature}=await (material??=crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify'])
      .then(async key=>({key,signature:await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(token))})))
    return crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(candidate))
  }
}
