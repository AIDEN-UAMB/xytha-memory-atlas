/** Only completed, saved answers enter this stream. This is delivery, not model reasoning. */
export function answerChunks(content:string){
 const points=Array.from(content),size=Math.max(8,Math.ceil(points.length/240));
 const chunks:string[]=[];for(let i=0;i<points.length;i+=size)chunks.push(points.slice(i,i+size).join(''));
 return chunks;
}
