// Container signature fixture only; deliberately makes no decode/completeness claim.
export function mp4Prefix(){const bytes=new Uint8Array(1024);bytes[3]=24;bytes.set(new TextEncoder().encode('ftypM4A '),4);return bytes;}
