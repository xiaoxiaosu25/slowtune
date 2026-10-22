// Test-only frozen-format reader; never imported by the running application.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
const [file,user,column,expectedJson,rulesJson]=process.argv.slice(2),expected=JSON.parse(expectedJson),rules=JSON.parse(rulesJson);
if(!['any','all'].includes(rules.mode)||!['upstream','random'].includes(rules.order)||Object.keys(rules).some(k=>!['include','exclude','mode','order'].includes(k))||[rules.include,rules.exclude].some(v=>!Array.isArray(v)||v.length>24||v.some(t=>typeof t!=='string'||!t.trim()||t.length>120)))throw new Error('Invalid legacy format');
const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE');
try{const current=db.prepare('SELECT * FROM recommendation_state WHERE user=? AND column_id=?').get(user,column);if(!current||current.entry!==expected.entry||current.epoch!==expected.epoch||current.legacy_revision!==expected.legacyRevision||current.shared_revision!==expected.sharedRevision)throw new Error('Conflict');
 const revision=randomUUID();db.prepare('INSERT INTO recommendation_revision VALUES(?,?,?,?,?)').run(user,column,0,revision,JSON.stringify(rules));db.prepare('UPDATE recommendation_state SET legacy_revision=?,epoch=epoch+1 WHERE user=? AND column_id=?').run(revision,user,column);db.exec('COMMIT');console.log(JSON.stringify({format:0,revision}));
}catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
