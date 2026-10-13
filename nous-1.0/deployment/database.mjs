import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';

export function openDatabase(filename, migrations=resolve('drizzle')) {
  if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _xytha_migrations(name TEXT PRIMARY KEY, digest TEXT NOT NULL)');
  for(const name of readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=readFileSync(resolve(migrations,name),'utf8');
    const digest=createHash('sha256').update(sql).digest('hex');
    const previous=sqlite.prepare('SELECT digest FROM _xytha_migrations WHERE name=?').get(name);
    if(previous){if(previous.digest!==digest)throw Error('Applied migration changed: '+name);continue;}
    sqlite.exec('BEGIN IMMEDIATE');
    try{sqlite.exec(sql);sqlite.prepare('INSERT INTO _xytha_migrations VALUES(?,?)').run(name,digest);sqlite.exec('COMMIT');}
    catch(error){sqlite.exec('ROLLBACK');throw error;}
  }
  class Prepared {
    constructor(query,values=[]){this.query=query;this.values=values;}
    bind(...values){return new Prepared(this.query,values);}
    execute(){
      const stmt=sqlite.prepare(this.query);
      if(stmt.columns().length){const results=stmt.all(...this.values);return {success:true,results,meta:{changes:0,duration:0}};}
      const meta=stmt.run(...this.values);
      return {success:true,results:[],meta:{changes:Number(meta.changes),last_row_id:Number(meta.lastInsertRowid),duration:0}};
    }
    async first(column){const row=sqlite.prepare(this.query).get(...this.values);return column?(row?.[column]??null):(row??null);}
    async all(){return this.execute();}
    async run(){return this.execute();}
    async raw({columnNames=false}={}){const stmt=sqlite.prepare(this.query);stmt.setReturnArrays(true);const rows=stmt.all(...this.values);return columnNames?[stmt.columns().map(c=>c.name),...rows]:rows;}
  }
  return {
    sqlite,
    prepare:q=>new Prepared(q),
    async batch(statements){
      sqlite.exec('BEGIN IMMEDIATE');
      try{const results=statements.map(s=>s.execute());sqlite.exec('COMMIT');return results;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
    async exec(sql){sqlite.exec(sql);return {count:1,duration:0};},
  };
}
