import { createHmac, timingSafeEqual } from 'node:crypto';

type SignatureInput = {
  secret: string;
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
};

// Formato documentado por MP: `x-signature: ts=<ts>,v1=<hmac>`, HMAC-SHA256 hex sobre
// `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. data.id sale del query string, en
// minúsculas; las partes que no vienen se omiten del manifest.
export function buildManifest(dataId: string | undefined, requestId: string | undefined, ts: string) {
  let manifest = '';
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${ts};`;
  return manifest;
}

export function signManifest(secret: string, manifest: string) {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

export function verifyMpSignature({ secret, xSignature, xRequestId, dataId }: SignatureInput): boolean {
  if (!xSignature) return false;
  const parts = new Map(
    xSignature.split(',').map((part) => {
      const [key, ...rest] = part.split('=');
      return [key?.trim(), rest.join('=').trim()] as const;
    }),
  );
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  if (!ts || !v1) return false;

  const expected = Buffer.from(signManifest(secret, buildManifest(dataId, xRequestId, ts)));
  const received = Buffer.from(v1);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
