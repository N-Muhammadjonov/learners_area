import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
let fontBytes: Promise<Buffer> | undefined;
/** Embed Unicode glyphs rather than replacing Uzbek or Cyrillic names with question marks. */
export async function renderStudentPdf(title:string,body:string[],documentId:string) {
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 fontBytes ??= readFile(path.join(process.cwd(),"src/assets/fonts/DejaVuSans.ttf"));
 const font=await pdf.embedFont(await fontBytes,{subset:true});
 pdf.setTitle(title);pdf.setProducer("Learners Area");
 let page=pdf.addPage([595,842]),y=790;
 const draw=(text:string,size=9)=>{
  for(const source of text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"").split(/\r?\n/)) {
   let line="";
   const flush=()=>{if(y<55){page=pdf.addPage([595,842]);y=790;}if(line)page.drawText(line.trimEnd(),{x:50,y,size,font,color:rgb(.12,.14,.23)});y-=size+5;line="";};
   for(const word of source.match(/\S+\s*|\s+/g) ?? []) {
    if(line && font.widthOfTextAtSize(line+word,size)>495)flush();
    if(font.widthOfTextAtSize(word,size)<=495)line+=word;
    else for(const character of word){if(font.widthOfTextAtSize(line+character,size)>495)flush();line+=character;}
   }
   if(y<55){page=pdf.addPage([595,842]);y=790;}if(line)page.drawText(line,{x:50,y,size,font,color:rgb(.12,.14,.23)});y-=size+5;
  }
 };
 draw(title,16);y-=12;for(const line of body)draw(line);
 pdf.getPages().forEach((sheet,i)=>sheet.drawText(`${documentId} · ${i+1}/${pdf.getPageCount()}`,{x:50,y:28,size:7,font,color:rgb(.4,.42,.5)}));
 return pdf.save();
}
