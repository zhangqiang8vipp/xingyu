import { bytesToBase64Url } from "@/db/admin-session";

export function randomToken(prefix: string, bytes = 32) {
  return `${prefix}${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))}`;
}

export function newAuthorizationCode() {
  return randomToken("xy_code_");
}

export function newAccessToken() {
  return randomToken("xy_at_");
}

export function newRefreshToken() {
  return randomToken("xy_rt_");
}

export function newFamilyId() {
  return randomToken("xy_fam_");
}
