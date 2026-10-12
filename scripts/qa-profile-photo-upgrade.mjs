import pg from 'pg';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
const name = `learners_photo_qa_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: 'postgres://postgres@localhost:5432/postgres', connectionTimeoutMillis: 5000 });
await admin.connect(); let created = false;
try {
 await admin.query(`create database ${name}`); created = true;
 const client = new pg.Client({ connectionString: `postgres://postgres@localhost:5432/${name}`, connectionTimeoutMillis: 5000 }); await client.connect();
 try {
  const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')).entries;
  for (const entry of journal.filter(row => row.idx <= 36)) for (const statement of readFileSync(`drizzle/${entry.tag}.sql`, 'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean)) await client.query(statement);
  const userId = randomUUID(); await client.query("insert into users(id,name,role,account_status) values($1,'Preserved profile','student','active')", [userId]);
  const before = (await client.query('select name,role,account_status from users where id=$1',[userId])).rows[0];
  const sql = readFileSync('drizzle/0037_profile_photos.sql','utf8'); await client.query(sql);
  assert.deepEqual((await client.query('select name,role,account_status from users where id=$1',[userId])).rows[0],before);
  await client.query("insert into user_profile_photos(user_id,image_base64,content_type) values($1,'YWJjZA==','image/jpeg')",[userId]);
  await assert.rejects(client.query("update user_profile_photos set content_type='image/svg+xml' where user_id=$1",[userId]),error=>error.code==='23514');
  await assert.rejects(client.query('update user_profile_photos set image_base64=$1 where user_id=$2',['A'.repeat(409601),userId]),error=>error.code==='23514');
  await client.query('delete from users where id=$1',[userId]); assert.equal((await client.query('select count(*)::int n from user_profile_photos')).rows[0].n,0);
  const receipt={pass:true,migration:37,migrationSha256:createHash('sha256').update(sql).digest('hex'),nativePostgres:(await client.query('show server_version')).rows[0].server_version,existingProfilePreserved:true,invalidMimeRejected:true,oversizeRejected:true,accountDeletionRemovesPhoto:true,remoteDatabaseUsed:false};
  writeFileSync('../evidence/profile-photo-native-upgrade.json',JSON.stringify(receipt,null,2)); console.log(receipt);
 } finally { await client.end(); }
} finally { if(created) await admin.query(`drop database ${name} with (force)`); await admin.end(); }
