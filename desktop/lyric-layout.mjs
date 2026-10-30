const clamp=value=>Math.max(0,Math.min(1,value));
export function floatingLineEnd(document,index) {
  const line=document?.lines[index];if(!line||line.startMs===null)return null;
  for(let next=index+1;next<document.lines.length;next++)if(document.lines[next].startMs>line.startMs)return document.lines[next].startMs;
  const end=document.durationMs-(document.offsetMs??0);
  if(end>line.startMs)return end;
  return line.words?.at(-1)?.endMs??null;
}
/** Visual panning follows real line bounds; it never creates word timing. */
export function floatingLinePan(time,start,end,overflow) {
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||overflow<=0)return 0;
  return -overflow*clamp((clamp((time-start)/(end-start))-.12)/.76);
}
