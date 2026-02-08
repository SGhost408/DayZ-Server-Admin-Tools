
/* DayZ Labs Offline SPA - no network calls */

const tools = new Map();
document.querySelectorAll('.tool-link').forEach(a=>{
  tools.set(a.dataset.tool, {
    id: a.dataset.tool,
    label: a.textContent.trim(),
    desc: a.dataset.description || ''
  });
});

const toolsView = document.getElementById('tools-view');
const contentContainer = document.getElementById('tool-content-container');
const contentEl = document.getElementById('tool-content');
const backBtn = document.getElementById('backBtn');
const resetBtn = document.getElementById('resetBtn');
const toggler = document.querySelector('.navbar-toggler');
const navMenu = document.getElementById('navMenu');

let currentToolId = '';

toggler?.addEventListener('click', ()=>{
  const isOpen = navMenu.classList.toggle('show');
  toggler.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});

function normalizeText(t){ return (t??"").toString().replace(/\r\n/g,"\n").replace(/\r/g,"\n"); }

function readFile(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=e=>resolve(normalizeText(e.target.result));
    r.onerror=reject;
    r.readAsText(file);
  });
}

function downloadText(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2500);
}

async function copyText(text){
  try { await navigator.clipboard.writeText(text); alert("Copied to clipboard."); }
  catch { alert("Copy failed. Select-all and copy manually."); }
}

// ---------- Parsers / helpers ----------
function parseTypesXml(xmlText){
  const xml = normalizeText(xmlText);
  const types = new Map();
  const typeRe = /<type\s+name="([^"]+)"[\s\S]*?<\/type>/gi;
  let m;
  while((m = typeRe.exec(xml)) !== null){
    const block = m[0];
    const name = m[1];
    const get = (tag) => {
      const r = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
      return r ? r[1].trim() : "";
    };
    types.set(name, {
      name,
      nominal: get("nominal"),
      lifetime: get("lifetime"),
      restock: get("restock"),
      min: get("min"),
      max: get("max"),
      raw: block
    });
  }
  return types;
}

function diffMaps(a,b, fields){
  const added=[], removed=[], changed=[];
  for (const [k,v] of b.entries()) if (!a.has(k)) added.push(v);
  for (const [k,v] of a.entries()) if (!b.has(k)) removed.push(v);
  for (const [k,av] of a.entries()){
    if (!b.has(k)) continue;
    const bv=b.get(k);
    const diffs = [];
    for (const f of fields){
      const x=(av[f]??""); const y=(bv[f]??"");
      if (x !== y) diffs.push({field:f, from:x, to:y});
    }
    if (diffs.length) changed.push({name:k, diffs});
  }
  return {added, removed, changed};
}

function parseCoordLine(line){
  const clean=(line||"").trim();
  if(!clean) return null;
  const parts = clean.includes(",") ? clean.split(",").map(s=>s.trim()).filter(Boolean) : clean.split(/\s+/).filter(Boolean);
  return parts;
}

// ---------- Tool implementations (offline) ----------
function tool_types(inputText, nominalValue){
  return normalizeText(inputText).replace(/<nominal>\d+<\/nominal>/gi, `<nominal>${nominalValue}</nominal>`);
}

function tool_nominaladjuster(inputText, nominalValue){
  return tool_types(inputText, nominalValue);
}

function tool_zero_nominal_updater(input, adjust, excludeList){
  const excludes = (excludeList||"").split(',').map(s=>s.trim()).filter(Boolean);
  let excludedCount=0, updatedCount=0;
  const pattern = /(<type\s+name="([^"]+)"[\s\S]*?<nominal>)(\s*0\s*)(<\/nominal>)/gi;
  const output = normalizeText(input).replace(pattern, (match, p1, name, p3, p4) => {
    for (const ex of excludes){
      if (name.includes(ex)) { excludedCount++; return match; }
    }
    updatedCount++;
    return p1 + adjust + p4;
  });
  return { output, updatedCount, excludedCount };
}

const VEHICLES = [
  'OffroadHatchback','OffroadHatchback_Blue','OffroadHatchback_White',
  'CivilianSedan','Hatchback_02','Hatchback_02_Black','Hatchback_02_Blue',
  'Sedan_02','Sedan_02_Grey','Sedan_02_Red','Truck_01_Base',
  'Truck_01_Covered','Truck_01_Covered_Blue','Truck_01_Covered_Orange','Offroad_02'
];
const BOATS = ['Boat_01_Black','Boat_01_Blue','Boat_01_Camo','Boat_01_Orange'];

function tool_vehicle_lifetime(input, lifetime, includeBoats){
  let classes = VEHICLES.slice();
  if (includeBoats) classes = classes.concat(BOATS);
  let output = normalizeText(input);
  let total = 0;
  classes.forEach(name => {
    const pattern = new RegExp(`(<type\\s+name="${name}"[\\s\\S]*?<lifetime>)(\\d+)(<\\/lifetime>)`, 'gi');
    output = output.replace(pattern, (match, p1, p2, p3) => { total++; return p1 + lifetime + p3; });
  });
  return { output, total };
}

function tool_tierRemover(input){
  let out = normalizeText(input);
  out = out.replace(/^\s*<value\s+name="Tier[^"]*"\s*\/>\s*$/gmi, "");
  out = out.replace(/<value\s+name="Tier[^"]*"\s*\/>\s*/gmi, "");
  out = out.replace(/<value\s+name="Tier[^"]*">[\s\S]*?<\/value>\s*/gmi, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim() + "\n";
}

function tool_classnames(input){
  const names = [];
  const re = /<type\s+name="([^"]+)"/gi;
  let m;
  const txt = normalizeText(input);
  while ((m = re.exec(txt)) !== null) names.push(m[1]);
  return names.join("\n") + (names.length ? "\n" : "");
}

function tool_classtotypes(classText, opts){
  const lines = normalizeText(classText).split("\n").map(s=>s.trim()).filter(Boolean);
  const cat = opts.category || "tools";
  const tpl = (name)=>`  <type name="${name}">
    <nominal>${opts.nominal}</nominal>
    <lifetime>${opts.lifetime}</lifetime>
    <restock>${opts.restock}</restock>
    <min>${opts.min}</min>
    <quantmin>-1</quantmin>
    <quantmax>-1</quantmax>
    <cost>100</cost>
    <flags count_in_cargo="0" count_in_hoarder="0" count_in_map="1" count_in_player="0" crafted="0" deloot="0"/>
    <category name="${cat}"/>
    <usage name="Town"/>
  </type>`;
  const body = lines.map(tpl).join("\n");
  return `<types>\n${body}\n</types>\n`;
}

function tool_customtypes(typesXml, opts){
  const only = (opts.only||"").split(',').map(s=>s.trim()).filter(Boolean);
  const txt = normalizeText(typesXml);
  const typeRe = /(<type\s+name="([^"]+)"[\s\S]*?<\/type>)/gi;
  let out = txt.replace(typeRe, (block, full, name)=>{
    if (only.length && !only.some(x=>name.includes(x))) return block;
    let b = block;
    b = b.replace(/<lifetime>\d+<\/lifetime>/i, `<lifetime>${opts.lifetime}</lifetime>`);
    b = b.replace(/<restock>\d+<\/restock>/i, `<restock>${opts.restock}</restock>`);
    return b;
  });
  return out;
}

function tool_typesusagespecific(typesXml, opts){
  const only = (opts.only||"").split(',').map(s=>s.trim()).filter(Boolean);
  const usageName = opts.usage;
  const txt = normalizeText(typesXml);
  const typeRe = /(<type\s+name="([^"]+)"[\s\S]*?<\/type>)/gi;
  let out = txt.replace(typeRe, (block, full, name)=>{
    if (only.length && !only.some(x=>name.includes(x))) return block;
    if (/<usage\s+name="/i.test(block)){
      return block.replace(/<usage\s+name="[^"]+"\s*\/>/i, `<usage name="${usageName}"/>`);
    }
    return block.replace(/<\/type>\s*$/i, `    <usage name="${usageName}"/>\n  </type>`);
  });
  return out;
}

function tool_playerspawn(text){
  const lines = normalizeText(text).split("\n");
  const points=[];
  for (const line of lines){
    const p=parseCoordLine(line);
    if(!p) continue;
    const nums = p.map(Number).filter(n=>Number.isFinite(n));
    if(nums.length>=2){
      const [x,y,z] = nums;
      points.push({x:x, y:y??0, z:z??0});
    }
  }
  return JSON.stringify(points, null, 2) + "\n";
}

function tool_zeds(text){ return tool_playerspawn(text); }

function tool_object(text){
  const lines = normalizeText(text).split("\n");
  const objects=[];
  for (const line of lines){
    const clean=line.trim();
    if(!clean) continue;
    const parts = clean.includes(",") ? clean.split(",").map(s=>s.trim()).filter(Boolean) : clean.split(/\s+/).filter(Boolean);
    if(parts.length>=4){
      const name = parts[0];
      const nums = parts.slice(1).map(Number);
      if(nums.every(n=>Number.isFinite(n))){
        const [x,y,z,yaw]=nums;
        objects.push({class:name, pos:{x,y,z}, yaw: yaw??0});
      }
    }
  }
  return JSON.stringify(objects, null, 2) + "\n";
}

function tool_traderplus(text){
  const lines = normalizeText(text).split("\n").map(s=>s.trim()).filter(Boolean);
  const items=[];
  for (const line of lines){
    const parts = line.includes(",") ? line.split(",").map(s=>s.trim()) : line.split(/\s+/);
    const cls = parts[0];
    const price = Number(parts[1] ?? 0);
    items.push({ClassName: cls, Price: Number.isFinite(price)?price:0});
  }
  return JSON.stringify(items, null, 2) + "\n";
}

function tool_traderobjects(text){
  const lines = normalizeText(text).split("\n").map(s=>s.trim()).filter(Boolean);
  const objs=[];
  for (const line of lines){
    const parts = line.includes(",") ? line.split(",").map(s=>s.trim()).filter(Boolean) : line.split(/\s+/).filter(Boolean);
    if(parts.length < 4) continue;
    const cls = parts[0];
    const nums = parts.slice(1).map(Number);
    if(!nums.every(n=>Number.isFinite(n))) continue;
    const [x,y,z,yaw] = nums;
    objs.push({
      ClassName: cls,
      Position: { x, y, z },
      Orientation: { yaw: yaw ?? 0 },
      Quantity: 1
    });
  }
  return JSON.stringify(objs, null, 2) + "\n";
}

function tool_trader(text){
  const lines = normalizeText(text).split("\n").map(s=>s.trim()).filter(Boolean);
  const items={};
  for (const line of lines){
    const parts = line.includes(",") ? line.split(",").map(s=>s.trim()) : line.split(/\s+/);
    const cls=parts[0];
    const price=Number(parts[1] ?? 0);
    items[cls] = { price: Number.isFinite(price)?price:0 };
  }
  return JSON.stringify(items, null, 2) + "\n";
}

function tool_extractor(text){
  const txt=normalizeText(text);
  const set=new Set();
  const qre = /"([A-Za-z0-9_\-]+)"/g;
  let m;
  while((m=qre.exec(txt))!==null) set.add(m[1]);
  const tre = /\b([A-Z][A-Za-z0-9_]+)\b/g;
  while((m=tre.exec(txt))!==null) set.add(m[1]);
  return Array.from(set).sort().join("\n") + "\n";
}

function tool_vehicleparts(text){
  const lines = normalizeText(text).split("\n").map(s=>s.trim()).filter(Boolean);
  const vehicles = lines.map(v=>({Vehicle:v, Parts:[]}));
  return JSON.stringify(vehicles, null, 2) + "\n";
}

function tool_zmbTerritories(text, opts){
  const dmin = opts.dmin;
  const dmax = opts.dmax;
  const tag = opts.tag;
  let out = normalizeText(text);
  const re = new RegExp(`<${tag}(\\s[^>]*?)>`, 'gi');
  out = out.replace(re, (m, attrs) => {
    let a = attrs;
    if (!/\bdmin\s*=\s*"/i.test(a)) a += ` dmin="${dmin}"`;
    if (!/\bdmax\s*=\s*"/i.test(a)) a += ` dmax="${dmax}"`;
    return `<${tag}${a}>`;
  });
  return out;
}

function tool_types_splitter(xmlText){
  // Split <type ...> blocks into chunks of 200 and output as concatenated sections
  const txt = normalizeText(xmlText);
  const blocks = txt.match(/<type\s+name="[^"]+"[\s\S]*?<\/type>/gi) || [];
  const chunkSize = 200;
  const chunks = [];
  for (let i=0;i<blocks.length;i+=chunkSize){
    const chunk = blocks.slice(i,i+chunkSize);
    chunks.push(`<!-- chunk ${(i/chunkSize)+1} (${chunk.length} types) -->\n<types>\n${chunk.join("\n")}\n</types>\n`);
  }
  return chunks.join("\n");
}

// ---------- UI rendering ----------
function toolForm(toolId){
  const t = tools.get(toolId);
  const descHtml = t?.desc ? `<div class="alert alert-secondary text-center mb-3">${t.desc}</div>` : '';
  const baseBtns = `
    <div class="d-flex gap-2" style="flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-secondary btn-sm" id="runBtn">Run</button>
      <button class="btn btn-outline-primary btn-sm" id="downloadBtn">Download Output</button>
      <button class="btn btn-outline-primary btn-sm" id="copyBtn">Copy Output</button>
    </div>
  `;
  const outArea = `<label class="form-label">Output</label><textarea class="form-control" id="out" rows="14" style="font-family: ui-monospace,Consolas,monospace"></textarea>`;

  const file1 = `<label class="form-label">Upload file</label><input class="form-control" type="file" id="file1">`;
  const file2 = `<label class="form-label">Upload second file</label><input class="form-control" type="file" id="file2">`;

  switch(toolId){
    case "types":
    case "nominaladjuster":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        <label class="form-label">New nominal</label>
        <input class="form-control" id="nominal" type="number" value="1">
        <div class="form-text">Updates all <code>&lt;nominal&gt;</code> values.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "zero_nominal_updater":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        <label class="form-label">New nominal for items currently at 0</label>
        <input class="form-control" id="adjust" type="number" value="1">
        <div style="height:10px"></div>
        <label class="form-label">Exclude classnames (comma separated)</label>
        <input class="form-control" id="exclude" type="text" placeholder="e.g. Flag, SomeItem">
        <div class="form-text">Only changes <code>&lt;nominal&gt;0&lt;/nominal&gt;</code> entries.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "vehicle_lifetime":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        <label class="form-label">New lifetime</label>
        <input class="form-control" id="lifetime" type="number" value="3888000">
        <div style="height:10px"></div>
        <label class="form-label"><input type="checkbox" id="boats"> Include boats</label>
        <div class="form-text">Updates lifetimes for common vanilla vehicles (and boats if selected).</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "tierRemover":
      return `${descHtml}<div class="card">
        ${file1}
        <div class="form-text">Removes Tier values inside each type block.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "classnames":
      return `${descHtml}<div class="card">
        ${file1}
        <div class="form-text">Outputs one classname per line.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "classtotypes":
      return `${descHtml}<div class="card">
        <label class="form-label">Upload classnames list (optional)</label>
        <input class="form-control" type="file" id="file1">
        <div style="height:10px"></div>
        <label class="form-label">Or paste classnames (one per line)</label>
        <textarea class="form-control" id="inputText" rows="10" style="font-family: ui-monospace,Consolas,monospace"></textarea>
        <div style="height:10px"></div>
        <div class="row g-3">
          <div class="col-6 col-md-4"><label class="form-label">Nominal</label><input class="form-control" id="ct_nominal" type="number" value="1"></div>
          <div class="col-6 col-md-4"><label class="form-label">Min</label><input class="form-control" id="ct_min" type="number" value="0"></div>
          <div class="col-6 col-md-4"><label class="form-label">Max</label><input class="form-control" id="ct_max" type="number" value="0"></div>
          <div class="col-6 col-md-4"><label class="form-label">Lifetime</label><input class="form-control" id="ct_lifetime" type="number" value="3888000"></div>
          <div class="col-6 col-md-4"><label class="form-label">Restock</label><input class="form-control" id="ct_restock" type="number" value="0"></div>
          <div class="col-6 col-md-4"><label class="form-label">Category</label><input class="form-control" id="ct_category" type="text" placeholder="tools"></div>
        </div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "customtypes":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        <div class="row g-3">
          <div class="col-6 col-md-4"><label class="form-label">Set lifetime</label><input class="form-control" id="set_lifetime" type="number" value="3888000"></div>
          <div class="col-6 col-md-4"><label class="form-label">Set restock</label><input class="form-control" id="set_restock" type="number" value="0"></div>
          <div class="col-12 col-md-4"><label class="form-label">Only these classnames</label><input class="form-control" id="only" type="text" placeholder="leave blank = all"></div>
        </div>
        <div class="form-text">Updates lifetime/restock across your types.xml (or only matching names).</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "typesusagespecific":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        <div class="row g-3">
          <div class="col-6 col-md-4"><label class="form-label">Usage name</label><input class="form-control" id="usage" type="text" value="Town"></div>
          <div class="col-6 col-md-4"><label class="form-label">Only these classnames</label><input class="form-control" id="only2" type="text" placeholder="leave blank = all"></div>
        </div>
        <div class="form-text">Adds or replaces a <code>&lt;usage name="..." /&gt;</code> entry per type.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "traderplus":
    case "traderobjects":
    case "trader":
    case "playerspawn":
    case "zeds":
    case "zeds2":
    case "vehicleparts":
    case "extractor":
    case "object":
    case "zmbTerritories":
    case "types_splitter":
      // These work from either uploaded file or pasted text
      return `${descHtml}<div class="card">
        <label class="form-label">Upload text file (optional)</label>
        <input class="form-control" type="file" id="file1">
        <div style="height:10px"></div>
        <label class="form-label">Or paste input</label>
        <textarea class="form-control" id="inputText" rows="10" style="font-family: ui-monospace,Consolas,monospace"></textarea>
        ${toolId === "zmbTerritories" ? `
          <div style="height:10px"></div>
          <div class="row g-3">
            <div class="col-6 col-md-4"><label class="form-label">dmin</label><input class="form-control" id="dmin" type="number" value="30"></div>
            <div class="col-6 col-md-4"><label class="form-label">dmax</label><input class="form-control" id="dmax" type="number" value="60"></div>
            <div class="col-6 col-md-4"><label class="form-label">Target tag</label><input class="form-control" id="tag" type="text" value="zone"></div>
          </div>
        ` : ``}
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    case "compare_types":
    case "compare_events":
      return `${descHtml}<div class="card">
        ${file1}
        <div style="height:10px"></div>
        ${file2}
        <div class="form-text">Produces a diff summary: added / removed / changed.</div>
        <div style="height:12px"></div>
        ${baseBtns}
        ${outArea}
      </div>`;
    default:
      return `${descHtml}<div class="alert">Tool UI not implemented.</div>`;
  }
}

async function getInputText(){
  const f = document.getElementById('file1')?.files?.[0];
  if (f) return await readFile(f);
  return normalizeText(document.getElementById('inputText')?.value || "");
}

async function runTool(toolId){
  let out = "";
  if (toolId === "types" || toolId === "nominaladjuster"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    const nominal = document.getElementById('nominal').value || "1";
    out = (toolId==="types") ? tool_types(txt, nominal) : tool_nominaladjuster(txt, nominal);
  } else if (toolId === "zero_nominal_updater"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    const adjust = document.getElementById('adjust').value || "1";
    const exclude = document.getElementById('exclude').value || "";
    const res = tool_zero_nominal_updater(txt, adjust, exclude);
    out = `<!-- ${res.updatedCount} updated, ${res.excludedCount} excluded -->\n` + res.output;
  } else if (toolId === "vehicle_lifetime"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    const lifetime = document.getElementById('lifetime').value || "3888000";
    const boats = document.getElementById('boats').checked;
    const res = tool_vehicle_lifetime(txt, lifetime, boats);
    out = `<!-- ${res.total} lifetimes updated -->\n` + res.output;
  } else if (toolId === "tierRemover"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    out = tool_tierRemover(txt);
  } else if (toolId === "classnames"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    out = tool_classnames(txt);
  } else if (toolId === "classtotypes"){
    const f = document.getElementById('file1')?.files?.[0];
    const pasted = normalizeText(document.getElementById('inputText').value || "");
    const txt = f ? await readFile(f) : pasted;
    if (!txt.trim()) return alert("Upload or paste classnames.");
    out = tool_classtotypes(txt, {
      nominal: document.getElementById('ct_nominal').value || "1",
      min: document.getElementById('ct_min').value || "0",
      max: document.getElementById('ct_max').value || "0",
      lifetime: document.getElementById('ct_lifetime').value || "3888000",
      restock: document.getElementById('ct_restock').value || "0",
      category: document.getElementById('ct_category').value || ""
    });
  } else if (toolId === "customtypes"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    out = tool_customtypes(txt, {
      lifetime: document.getElementById('set_lifetime').value || "3888000",
      restock: document.getElementById('set_restock').value || "0",
      only: document.getElementById('only').value || ""
    });
  } else if (toolId === "typesusagespecific"){
    const file = document.getElementById('file1')?.files?.[0];
    if (!file) return alert("Upload a types.xml file.");
    const txt = await readFile(file);
    out = tool_typesusagespecific(txt, {
      usage: document.getElementById('usage').value || "Town",
      only: document.getElementById('only2').value || ""
    });
  } else if (toolId === "compare_types"){
    const a = document.getElementById('file1')?.files?.[0];
    const b = document.getElementById('file2')?.files?.[0];
    if (!a || !b) return alert("Upload BOTH files.");
    const t1 = await readFile(a);
    const t2 = await readFile(b);
    const m1 = parseTypesXml(t1);
    const m2 = parseTypesXml(t2);
    const d = diffMaps(m1,m2, ["nominal","min","max","lifetime","restock"]);
    out = [
      "=== TYPES DIFF ===",
      "",
      `Added: ${d.added.length}`,
      ...d.added.map(x=>`+ ${x.name}`),
      "",
      `Removed: ${d.removed.length}`,
      ...d.removed.map(x=>`- ${x.name}`),
      "",
      `Changed: ${d.changed.length}`,
      ...d.changed.map(c=>`* ${c.name} :: ` + c.diffs.map(dd=>`${dd.field} ${dd.from} -> ${dd.to}`).join(", ")),
      ""
    ].join("\n");
  } else if (toolId === "compare_events"){
    const a = document.getElementById('file1')?.files?.[0];
    const b = document.getElementById('file2')?.files?.[0];
    if (!a || !b) return alert("Upload BOTH files.");
    const t1 = await readFile(a);
    const t2 = await readFile(b);
    const parseEvents = (xml) => {
      const m = new Map();
      const re = /<event\s+name="([^"]+)"[\s\S]*?<\/event>/gi;
      let mm;
      const t = normalizeText(xml);
      while((mm=re.exec(t))!==null){
        const block=mm[0], name=mm[1];
        const get = (tag)=>{ const r=new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block); return r? r[1].trim() : ""; };
        m.set(name, {name, nominal:get("nominal"), min:get("min"), max:get("max"), lifetime:get("lifetime")});
      }
      return m;
    };
    const m1 = parseEvents(t1);
    const m2 = parseEvents(t2);
    const d = diffMaps(m1,m2, ["nominal","min","max","lifetime"]);
    out = [
      "=== EVENTS DIFF ===",
      "",
      `Added: ${d.added.length}`,
      ...d.added.map(x=>`+ ${x.name}`),
      "",
      `Removed: ${d.removed.length}`,
      ...d.removed.map(x=>`- ${x.name}`),
      "",
      `Changed: ${d.changed.length}`,
      ...d.changed.map(c=>`* ${c.name} :: ` + c.diffs.map(dd=>`${dd.field} ${dd.from} -> ${dd.to}`).join(", ")),
      ""
    ].join("\n");
  } else {
    // text/paste based tools
    const input = await getInputText();
    if (!input.trim()) return alert("Upload or paste input.");
    switch(toolId){
      case "traderplus": out = tool_traderplus(input); break;
      case "traderobjects": out = tool_traderobjects(input); break;
      case "trader": out = tool_trader(input); break;
      case "playerspawn": out = tool_playerspawn(input); break;
      case "zeds":
      case "zeds2": out = tool_zeds(input); break;
      case "vehicleparts": out = tool_vehicleparts(input); break;
      case "extractor": out = tool_extractor(input); break;
      case "object": out = tool_object(input); break;
      case "zmbTerritories":
        out = tool_zmbTerritories(input, {
          dmin: document.getElementById('dmin').value || "30",
          dmax: document.getElementById('dmax').value || "60",
          tag: document.getElementById('tag').value || "zone"
        });
        break;
      case "types_splitter": out = tool_types_splitter(input); break;
      default: out = "Tool not wired yet."; break;
    }
  }

  document.getElementById('out').value = out;
}

function loadTool(toolId, push=true){
  const tool = tools.get(toolId);
  if (!tool) return;
  currentToolId = toolId;
  contentEl.innerHTML = toolForm(toolId);

  toolsView.style.display = 'none';
  contentContainer.style.display = 'block';

  const runBtn = document.getElementById('runBtn');
  const dlBtn = document.getElementById('downloadBtn');
  const cpBtn = document.getElementById('copyBtn');
  runBtn.onclick = () => runTool(toolId);
  dlBtn.onclick = () => downloadText(`${toolId}_output.txt`, document.getElementById('out').value || "");
  cpBtn.onclick = () => copyText(document.getElementById('out').value || "");

  if (push){
    history.pushState({tool: toolId}, '', `#${toolId}`);
    document.title = `DayZ Labs | ${tool.label}`;
  }
}

document.querySelectorAll('.tool-link').forEach(link=>{
  link.addEventListener('click', e=>{
    e.preventDefault();
    loadTool(link.dataset.tool);
  });
});

backBtn.addEventListener('click', ()=>{
  contentContainer.style.display = 'none';
  toolsView.style.display = 'block';
  history.pushState({}, '', '#');
  document.title = 'DayZ Labs | Server Admin Tools (Offline)';
});

resetBtn.addEventListener('click', ()=>{
  if (currentToolId) loadTool(currentToolId, false);
  else location.hash = '#';
});

window.addEventListener('popstate', e=>{
  const state = e.state;
  if (!state || !state.tool){
    contentContainer.style.display = 'none';
    toolsView.style.display = 'block';
    document.title = 'DayZ Labs | Server Admin Tools (Offline)';
  } else {
    loadTool(state.tool, false);
  }
});

// Load tool from hash on first open
window.addEventListener('DOMContentLoaded', ()=>{
  const id = (location.hash || '').replace('#','').trim();
  if (id && tools.has(id)) loadTool(id, false);
});
