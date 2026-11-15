const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const esbuild = require('esbuild');

test('workspace selections remain within one investigation, including empty and single-experiment cases', () => {
  const built=esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../src/state/selection.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
  const mod=new Module(path.join(__dirname,'selection-test.cjs'),module);
  mod._compile(built.outputFiles[0].text,mod.id);
  const {experimentsForInvestigation,selectWorkspace,validComparisonIds}=mod.exports;
  const ranked=[{psi_id:'A',top_experiments:[{experiment_id:'A2',rank:2},{experiment_id:'A1',rank:1}]},{psi_id:'B',top_experiments:[{experiment_id:'B1',rank:1}]},{psi_id:'EMPTY',top_experiments:[]}];
  assert.deepEqual(experimentsForInvestigation(ranked,'A').map(e=>e.experiment_id),['A1','A2']);
  assert.deepEqual(selectWorkspace(ranked,'A',{activeId:'B1',compareIds:['B1','A2','A2']}),{investigationId:'A',activeId:'A1',compareIds:['A2','A1']});
  assert.deepEqual(selectWorkspace(ranked,'B',{activeId:'A2',compareIds:['A1','A2']}),{investigationId:'B',activeId:'B1',compareIds:['B1']});
  assert.deepEqual(selectWorkspace(ranked,'EMPTY',{activeId:'B1',compareIds:['B1']}),{investigationId:'EMPTY',activeId:null,compareIds:[]});
  assert.deepEqual(selectWorkspace([],null),{investigationId:null,activeId:null,compareIds:[]});
  assert.equal(selectWorkspace(ranked,'A',{activeId:'A2',compareIds:[]}).activeId,'A2');
  assert.deepEqual(validComparisonIds(['B1','A2','A2','A1'],experimentsForInvestigation(ranked,'A')),['A2','A1']);
});

// Compile the real browser API module for Node, replacing only Vite's public URL.
const built = esbuild.buildSync({ entryPoints: [path.resolve(__dirname,'../src/lib/api.ts')], bundle:true,
  write:false, platform:'node',format:'cjs',define:{'import.meta.env.VITE_API_BASE_URL':'"/api"','import.meta.env.VITE_DATA_SOURCE':'"api"'} });
const compiled = new Module(path.join(__dirname,'api-test.cjs'),module);
compiled.filename = path.join(__dirname,'api-test.cjs');
compiled.paths = module.paths;
compiled._compile(built.outputFiles[0].text,compiled.filename);
const api = compiled.exports;
const catalogBuild=esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../src/lib/sourceCatalog.ts')],bundle:true,write:false,platform:'node',format:'cjs'});
const catalogModule=new Module(path.join(__dirname,'catalog-test.cjs'),module);
catalogModule.filename=path.join(__dirname,'catalog-test.cjs');catalogModule.paths=module.paths;
catalogModule._compile(catalogBuild.outputFiles[0].text,catalogModule.filename);
test('source identity merges DOI aliases, preserves document versions and unidentified variants',()=>{
  const id=catalogModule.exports.sourceIdentity;
  assert.equal(id({url:'https://doi.org/10.1234/ABC'},'PSI-25',[]),id({url:'https://doi.org/10.1234/abc#page=4'},'PSI-25',[]));
  assert.notEqual(id({label:'report_v3.pdf',kind:'report'},'PSI-25',['PSI-25/reports/report_v3.pdf']),id({label:'report_v4.pdf',kind:'report'},'PSI-25',['PSI-25/reports/report_v4.pdf']));
  assert.notEqual(id({label:'Unknown report',pages:'4'},'PSI-25',[]),id({label:'Unknown report',pages:'7'},'PSI-25',[]));
});
const root = path.resolve(__dirname,'../..');
const output = JSON.parse(fs.readFileSync(path.join(root,'backend/runs/hydrogen-test/output.json'),'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(root,'docs/workspace-fixture.json'),'utf8'));
const request = {input:JSON.parse(fs.readFileSync(path.join(root,'backend/data/demo/demo_query.json'),'utf8')),research_question:'integration question'};
const reply = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('actual envelope is unwrapped and inline records avoid an extra HTTP call', async () => {
  const calls=[];
  global.fetch=async(url,opts) => {calls.push([url,opts]);return reply(fixture);};
  const result=await api.search(request);
  assert.equal(result.output.ranked[0].psi_id,'PSI-25');
  assert.equal(result.records['PSI-69-CS55'].tests[0].pressure_kpa,71.6);
  assert.equal(result.records['PSI-25-CS07'].tests[0].airflow_cm_s,null);
  assert.equal(result.meta.model,'gemini-4-hydrogen');
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'/api/search');
  assert.equal(JSON.parse(calls[0][1].body).research_question,request.research_question);
});
test('bare output contract uses the real numeric records endpoint',async()=>{
  const calls=[];
  global.fetch=async(url)=>{calls.push(url);return reply(calls.length===1?output:{records:fixture.records});};
  const result=await api.search(request);
  assert.ok(calls[1].startsWith('/api/records?experiment_ids='));
  assert.equal(Object.keys(result.records).length,6);
});
test('backend error details survive; failed search never returns demo output',async()=>{
  global.fetch=async()=>reply({error:'A search is already running.',details:['Wait for it to finish.']},409);
  await assert.rejects(api.search(request),e=>e.message==='A search is already running.' && e.details[0]==='Wait for it to finish.');
});
test('saved-example backend cannot masquerade as a live API result',async()=>{
  global.fetch=async()=>reply({...fixture,meta:{...fixture.meta,mode:'saved_example'}});
  await assert.rejects(api.search(request),/saved.example/i);
});
test('records failure stays distinct from absent scientific measurements',async()=>{
  let calls=0;
  global.fetch=async()=>++calls===1?reply(output):reply({error:'Records unavailable'},503);
  const result=await api.search(request);
  assert.equal(Object.keys(result.records).length,0);
  assert.ok(result.warnings.some(w=>w.includes('503')));
  assert.equal(result.output.ranked.length,2);
});
test('invalid output and invalid inputs retain schema errors',async()=>{
  global.fetch=async()=>reply({output:{ranked:[]},meta:{mode:'live'}});
  await assert.rejects(api.search(request),e=>e instanceof api.SchemaError && e.stage==='output');
  await assert.rejects(api.search({input:{wrong:true},research_question:null}),e=>e instanceof api.SchemaError && e.stage==='input');
});
test('no local ranking or synthetic demo is reachable through API module',()=>{
  assert.equal(api.DATA_SOURCE,'api');
  const source=fs.readFileSync(path.join(__dirname,'../src/lib/api.ts'),'utf8');
  assert.doesNotMatch(source,/DEMO_CATALOG|runEngine/);
});
test('zero is preserved; invalid numeric strings never become chart values',async()=>{
  const body=structuredClone(fixture);
  const row=body.records[0].tests[0];
  row.airflow_cm_s=0;
  row.pressure_kpa='101.3';
  row.measurements=[{quantity:'burning_rate',value:0,unit:'mm²/s',definition:'Recorded zero'},
    {quantity:'burning_rate',value:'2.2',unit:'mm²/s',definition:'Invalid string'}];
  global.fetch=async()=>reply(body);
  const r=await api.search(request);
  const loaded=r.records[body.records[0].experiment_id].tests[0];
  assert.equal(loaded.airflow_cm_s,0);
  assert.equal(loaded.pressure_kpa,null);
  assert.equal(loaded.measurements.length,1);
  assert.equal(loaded.measurements[0].value,0);
});
