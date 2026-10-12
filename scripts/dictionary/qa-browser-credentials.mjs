import pg from 'pg';
import bcrypt from 'bcryptjs';
import {assertIsolatedTarget} from '../qa2-seed-fixtures.mjs';
assertIsolatedTarget('postgres://postgres@localhost:5432/learners_qa2');
const client=new pg.Client({connectionString:'postgres://postgres@localhost:5432/learners_qa2'});
await client.connect();const hash=await bcrypt.hash('QaDictionary2026!',10);
await client.query("update users set password_hash=$1,onboarding_completed_at=now(),locale='uz' where email in ('qa2-owner@learners-qa.invalid','qa2-student@learners-qa.invalid')",[hash]);await client.end();
