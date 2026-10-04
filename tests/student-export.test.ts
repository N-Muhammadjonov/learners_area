import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { renderStudentArchive, type StudentArchive } from "../src/lib/student-export/format";
const archive: StudentArchive = {version:1,id:"export-qa",generatedAt:"2026-10-04T00:00:00Z",students:[{id:"student-qa",name:"O'zbek Ғолиб",email:null,accountStatus:"active",createdAt:new Date("2026-01-01")}],results:{writing:[{userId:"student-qa",feedback:"O'zbekcha javob va Кирилл matn ".repeat(500)}]}};
test("student archive preserves Unicode, paginates PDF and validates ZIP checksums", async()=>{
 const pdf=await PDFDocument.load(await renderStudentArchive(archive,"pdf"));
 assert.ok(pdf.getPageCount()>1); assert.equal(pdf.getTitle(),"Learners Area - Student records");
 const docx=unzipSync(await renderStudentArchive(archive,"docx"));
 assert.match(strFromU8(docx["word/document.xml"]!),/Ғолиб/);
 const zip=unzipSync(await renderStudentArchive(archive,"zip"));
 const manifest=JSON.parse(strFromU8(zip["manifest.json"]!));
 for(const [name,entry] of Object.entries(manifest.files) as [string,{sha256:string;bytes:number}][]){assert.equal(createHash("sha256").update(zip[name]!).digest("hex"),entry.sha256);assert.equal(zip[name]!.length,entry.bytes);}
 assert.match(strFromU8(zip["students.json"]!),/Ғолиб/);
 assert.deepEqual(Object.keys(zip).sort(),["manifest.json","students.docx","students.json","students.pdf"]);
});
