
export function qs(sel) { return document.querySelector(sel); }
export function getParam(name, def=null) { const u = new URL(location.href); return u.searchParams.get(name) || def; }
export function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
export function now() { return Date.now(); }
export function median(arr){ if(arr.length===0) return 0; const s=[...arr].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2? s[m] : (s[m-1]+s[m])/2; }
export function p95(arr){ if(arr.length===0) return 0; const s=[...arr].sort((a,b)=>a-b); const i=Math.floor(0.95*(s.length-1)); return s[i]; }
export function clamp01(x){ return Math.max(0, Math.min(1, x)); }
