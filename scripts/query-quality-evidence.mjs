import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.argv[2], { readOnly: true })
console.log('RUN', JSON.stringify(db.prepare("SELECT id,status,error,finished_at FROM agent_runs WHERE id='run_01m5ye19mgmh1bkv5xm8q4mqdj'").all(), null, 2))
console.log('STEPS', JSON.stringify(db.prepare("SELECT kind,title,payload_json,created_at FROM run_steps WHERE run_id='run_01m5ye19mgmh1bkv5xm8q4mqdj' ORDER BY seq").all().slice(-12), null, 2))
console.log('EVENTS', JSON.stringify(db.prepare("SELECT event_type,subject_id,created_at,payload_json FROM project_events WHERE subject_id IN ('pln_01m5ydygxrw2cxs2hvjhc8bs1j','tsk_01m5ydyw6gjdhp6xnvffdtttwg') ORDER BY created_at").all().slice(-20), null, 2))
console.log('TOOLS', JSON.stringify(db.prepare("SELECT tool_name,status,error,created_at FROM tool_calls WHERE run_id='run_01m5ye19mgmh1bkv5xm8q4mqdj' ORDER BY created_at").all().slice(-8), null, 2))
